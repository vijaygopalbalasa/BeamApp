/**
 * BEAM PROGRAM CLIENT - COMPREHENSIVE DOCUMENTATION
 *
 * PROGRAM OVERVIEW:
 * - Program ID: 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi
 * - Network: Solana Devnet
 * - Deployed Slot: 415476588
 * - Purpose: Offline-first P2P payments with escrow and attestation verification
 *
 * REACT NATIVE / HERMES COMPATIBILITY:
 * =====================================
 * This client implements MANUAL INSTRUCTION BUILDING to bypass Anchor's BufferLayout
 * serialization, which fails in React Native/Hermes environments with:
 * "Cannot read property 'size' of undefined"
 *
 * Root Cause:
 * - Anchor's .instruction() method uses BufferLayout internally
 * - BufferLayout relies on Node.js-specific Buffer behavior
 * - Hermes engine lacks full Buffer polyfill support
 *
 * Solution:
 * - All instructions manually constructed using raw discriminators from IDL
 * - Data serialization uses Buffer.alloc() and manual encoding
 * - Custom transaction compiler (lines 215-362) bypasses Anchor's serialization
 * - No dependency on Anchor's method builder after initialization
 *
 * Manual Instruction Builders:
 * - buildInitializeNonceRegistryInstruction() - Lines 151-180
 * - buildInitializeEscrowInstruction() - Lines 459-498
 * - buildSettleOfflinePaymentInstruction() - Lines 599-698
 * - buildFundEscrowInstruction() - Lines 805-842
 * - buildWithdrawEscrowInstruction() - Lines 880-917
 * - buildReportFraudulentBundleInstruction() - Lines 1066-1126
 *
 * Each builder manually:
 * 1. Encodes 8-byte discriminator from IDL
 * 2. Serializes arguments (u64, strings, enums, structs)
 * 3. Builds accounts array with correct pubkey/signer/writable flags
 * 4. Returns TransactionInstruction ready for custom compiler
 *
 * ACCOUNT STRUCTURES:
 *
 * 1. OfflineEscrowAccount (PDA: seeds=[b"escrow", owner])
 *    - owner: Pubkey (32 bytes)
 *    - escrow_token_account: Pubkey (32 bytes)
 *    - escrow_balance: u64 (8 bytes) - USDC balance in smallest units
 *    - last_nonce: u64 (8 bytes) - Latest settled nonce
 *    - reputation_score: u16 (2 bytes) - User reputation (0-65535)
 *    - total_spent: u64 (8 bytes) - Lifetime spending
 *    - created_at: i64 (8 bytes) - Unix timestamp
 *    - bump: u8 (1 byte) - PDA bump seed
 *
 * 2. NonceRegistry (PDA: seeds=[b"nonce", payer])
 *    - owner: Pubkey (32 bytes)
 *    - last_nonce: u64 (8 bytes) - Latest nonce (replay protection)
 *    - recent_bundle_hashes: Vec<[u8; 32]> (max 16) - Duplicate detection
 *    - bundle_history: Vec<BundleRecord> (max 32) - Settlement history
 *    - fraud_records: Vec<FraudRecord> (max 16) - Fraud evidence
 *    - bump: u8 (1 byte) - PDA bump seed
 *
 * SECURITY MECHANISMS:
 * ✓ Nonce Replay Protection: Enforces nonce > last_nonce
 * ✓ Duplicate Detection: Tracks recent bundle hashes (16-entry ring buffer)
 * ✓ Attestation Verification: Ed25519 signature from trusted verifier
 * ✓ Timestamp Validation: Attestations valid for 24 hours
 * ✓ Checked Arithmetic: Prevents overflow/underflow
 * ✓ PDA Authority: Escrow controlled by program PDA
 * ✓ Fraud Reporting: Track conflicting bundles
 *
 * INSTRUCTION FLOW:
 * 1. InitializeEscrow: Create escrow + optional initial deposit
 * 2. InitializeNonceRegistry: Create nonce tracking account
 * 3. FundEscrow: Add USDC to escrow balance
 * 4. SettleOfflinePayment: Verify attestation + transfer to merchant
 * 5. ReportFraudulentBundle: Submit conflicting evidence
 * 6. WithdrawEscrow: Withdraw unused funds
 */

import { Connection, PublicKey, Transaction, SystemProgram, Commitment } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { Buffer } from 'buffer';
import BeamIDL from '../idl/beam.json';
import { Config } from '../config';
import type { BeamSigner } from '../wallet/WalletManager';
import {
  EscrowAccount,
  ConnectionTestResult,
  NonceRegistryAccount,
  FraudReason,
  BundleHistoryEntry,
  FraudRecordEntry,
} from './types';
import bs58 from 'bs58';
import { getAssociatedTokenAddress } from './utils';

const PROGRAM_ID = new PublicKey(Config.program.id);
const USDC_MINT = new PublicKey(Config.tokens.usdc.mint);
const USDC_SCALE = 10 ** Config.tokens.usdc.decimals;

interface AttestationProofArgs {
  root: Uint8Array;
  nonce: Uint8Array;
  timestamp: number;
  signature: Uint8Array;
}

interface SettlementEvidenceArgs {
  payerProof: AttestationProofArgs | null;  // Allow null for online payments
  merchantProof?: AttestationProofArgs | null;
}

/**
 * Raw instruction data format that bypasses TransactionInstruction class
 * This avoids buffer-layout serialization issues in React Native/Hermes
 */
interface RawInstruction {
  programId: PublicKey;
  keys: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Buffer;
}

export type FraudReasonKind = FraudReason;

export class BeamProgramClient {
  private readonly connection: Connection;
  private readonly program: Program | null;
  private readonly provider: AnchorProvider | null;
  private readonly signer: BeamSigner | null;

  constructor(rpcUrlOrConnection: string | Connection = Config.solana.rpcUrl[0], signer?: BeamSigner) {
    // Accept either an RPC URL string or an existing Connection instance
    if (typeof rpcUrlOrConnection === 'string') {
      // Create a React Native–safe Connection with explicit fetch + headers
      this.connection = new Connection(rpcUrlOrConnection, {
        commitment: Config.solana.commitment as Commitment,
        confirmTransactionInitialTimeout: Config.solana.confirmationTimeout ?? 30000,
        disableRetryOnRateLimit: false,
        httpHeaders: { 'Content-Type': 'application/json' },
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), Config.solana.confirmationTimeout ?? 30000);
          return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        },
      });
    } else {
      this.connection = rpcUrlOrConnection;
    }
    this.signer = signer ?? null;

    if (signer) {
      const signAny = async <T extends Transaction>(tx: T): Promise<T> => {
        const legacyTx = tx as Transaction;
        const payer = legacyTx.feePayer ?? signer.publicKey;
        let recentBlockhash = legacyTx.recentBlockhash;
        if (!recentBlockhash) {
          const latest = await this.connection.getLatestBlockhash('confirmed');
          recentBlockhash = latest.blockhash;
        }

        const compiled = this.compileMessage(payer, legacyTx.instructions, recentBlockhash);
        if (compiled.signerPubkeys.length !== 1 || !compiled.signerPubkeys[0].equals(signer.publicKey)) {
          throw new Error('Unsupported signer configuration');
        }
        const signature = await signer.sign(compiled.message, 'Authorize Solana transaction');
        legacyTx.feePayer = payer;
        legacyTx.recentBlockhash = recentBlockhash;
        legacyTx.signatures = compiled.signerPubkeys.map(pubkey => ({
          publicKey: pubkey,
          signature: pubkey.equals(signer.publicKey) ? Buffer.from(signature) : null,
        }));
        return legacyTx as T;
      };

      const anchorWallet: any = {
        publicKey: signer.publicKey,
        signTransaction: signAny,
        signAllTransactions: async <T extends Transaction>(txs: T[]): Promise<T[]> =>
          Promise.all(txs.map(tx => signAny(tx))),
      };

      this.provider = new (AnchorProvider as any)(this.connection, anchorWallet, {
        commitment: Config.solana.commitment,
      }) as any;

      // CRITICAL FIX: DO NOT instantiate Anchor Program in React Native/Hermes
      // Anchor's Program class uses buffer-layout for serialization, which has
      // the "Cannot read property 'size' of undefined" error in Hermes engine.
      // We use manual instruction building instead (buildInitializeEscrowInstruction, etc.)
      this.program = null;
      console.log('[BeamProgram] Constructor: Skipping Anchor Program instantiation (using manual instructions)');
    } else {
      // Read-only mode: avoid constructing Anchor Provider/Program to prevent RN runtime issues
      this.provider = null;
      this.program = null;
      console.log('[BeamProgram] Constructor: Read-only mode (no signer provided)');
    }
  }

  /**
   * Manually builds initializeNonceRegistry instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [34, 149, 53, 133, 236, 53, 88, 85]
   * - No args (nonce registry has no parameters)
   */
  private buildInitializeNonceRegistryInstruction(
    payer: PublicKey,
    nonceRegistry: PublicKey
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 150-158)
    const discriminator = Buffer.from([34, 149, 53, 133, 236, 53, 88, 85]);

    // No additional data - discriminator only
    const data = discriminator;

    // Build accounts array according to IDL order (lines 160-192)
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },             // payer (signer, writable)
      { pubkey: nonceRegistry, isSigner: false, isWritable: true },    // nonce_registry (PDA, writable)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  async ensureNonceRegistry(): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    const [nonceRegistry] = this.findNonceRegistry(this.signer.publicKey);
    const account = await this.connection.getAccountInfo(nonceRegistry);
    if (account) {
      return;
    }

    // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
    console.log('[BeamProgram] Building initializeNonceRegistry instruction manually...');
    const instruction = this.buildInitializeNonceRegistryInstruction(
      this.signer.publicKey,
      nonceRegistry
    );

    await this.signAndBroadcast(
      this.signer.publicKey,
      [instruction],
      'Initialize Nonce Registry',
    );
  }

  findEscrowPDA(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('escrow'), owner.toBuffer()], PROGRAM_ID);
  }

  findNonceRegistry(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('nonce'), owner.toBuffer()], PROGRAM_ID);
  }

  private compileMessage(
    payer: PublicKey,
    instructions: RawInstruction[],
    recentBlockhash: string,
  ) {
    type Meta = {
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
      isPayer: boolean;
      appearance: number;
    };

    const metas = new Map<string, Meta>();
    let appearanceCounter = 0;

    const addMeta = (pubkey: PublicKey, opts: Partial<Meta>) => {
      const key = pubkey.toBase58();
      const existing = metas.get(key);
      if (existing) {
        existing.isSigner = existing.isSigner || !!opts.isSigner;
        existing.isWritable = existing.isWritable || !!opts.isWritable;
        existing.isPayer = existing.isPayer || !!opts.isPayer;
        return existing;
      }
      const meta: Meta = {
        pubkey,
        isSigner: !!opts.isSigner,
        isWritable: !!opts.isWritable,
        isPayer: !!opts.isPayer,
        appearance: opts.appearance ?? appearanceCounter++,
      };
      metas.set(key, meta);
      return meta;
    };

    addMeta(payer, { isSigner: true, isWritable: true, isPayer: true, appearance: -1 });

    instructions.forEach(ix => {
      addMeta(ix.programId, { isSigner: false, isWritable: false });
      ix.keys.forEach(meta => {
        addMeta(meta.pubkey, {
          isSigner: meta.isSigner,
          isWritable: meta.isWritable,
        });
      });
    });

    const rank = (meta: Meta) => {
      if (meta.isPayer) return 0;
      if (meta.isSigner && meta.isWritable) return 1;
      if (meta.isSigner) return 2;
      if (meta.isWritable) return 3;
      return 4;
    };

    const orderedMetas = Array.from(metas.values()).sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.appearance - b.appearance;
    });

    const accountKeys = orderedMetas.map(meta => meta.pubkey);
    const numRequiredSignatures = orderedMetas.filter(meta => meta.isSigner).length;
    const numReadonlySigned = orderedMetas.filter(meta => meta.isSigner && !meta.isWritable).length;
    const numReadonlyUnsigned = orderedMetas.filter(meta => !meta.isSigner && !meta.isWritable).length;

    const accountIndex = new Map<string, number>();
    accountKeys.forEach((pubkey, index) => {
      accountIndex.set(pubkey.toBase58(), index);
    });

    const message: number[] = [];
    message.push(numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned);

    this.pushBytes(message, this.encodeLength(accountKeys.length));
    accountKeys.forEach(pubkey => this.pushBytes(message, pubkey.toBuffer()));

    this.pushBytes(message, bs58.decode(recentBlockhash));

    this.pushBytes(message, this.encodeLength(instructions.length));

    instructions.forEach(ix => {
      const programIndex = accountIndex.get(ix.programId.toBase58());
      if (programIndex === undefined) {
        throw new Error('Program ID not found in account list');
      }
      message.push(programIndex);

      const indices = ix.keys.map(meta => {
        const idx = accountIndex.get(meta.pubkey.toBase58());
        if (idx === undefined) {
          throw new Error('Instruction account not found in account list');
        }
        return idx;
      });

      this.pushBytes(message, this.encodeLength(indices.length));
      this.pushBytes(message, Uint8Array.from(indices));

      const dataBytes = ix.data instanceof Uint8Array ? ix.data : Uint8Array.from(ix.data);
      this.pushBytes(message, this.encodeLength(dataBytes.length));
      this.pushBytes(message, dataBytes);
    });

    return {
      message: Uint8Array.from(message),
      signerPubkeys: accountKeys.slice(0, numRequiredSignatures),
      accountKeys,
    };
  }

  private encodeLength(length: number): Uint8Array {
    const out: number[] = [];
    let rem = length;
    while (true) {
      const elem = rem % 0x80;
      rem = Math.floor(rem / 0x80);
      if (rem === 0) {
        out.push(elem);
        break;
      } else {
        out.push(elem + 0x80);
      }
    }
    return Uint8Array.from(out);
  }

  private pushBytes(target: number[], bytes: Uint8Array | Buffer | number[]) {
    if (Array.isArray(bytes)) {
      for (const b of bytes) target.push(b);
      return;
    }
    for (const b of bytes) target.push(b);
  }

  private concatUint8(arrays: (Uint8Array | Buffer)[]): Uint8Array {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    arrays.forEach(arr => {
      const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
      out.set(bytes, offset);
      offset += bytes.length;
    });
    return out;
  }

  private async signAndBroadcast(
    payer: PublicKey,
    instructions: RawInstruction[],
    prompt: string,
  ): Promise<string> {
    if (!this.signer) throw new Error('Signer required');

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const compiled = this.compileMessage(payer, instructions, blockhash);

    if (compiled.signerPubkeys.length !== 1 || !compiled.signerPubkeys[0].equals(this.signer.publicKey)) {
      throw new Error('Unsupported signer configuration');
    }

    const signature = await this.signer.sign(compiled.message, prompt);
    if (signature.length !== 64) {
      throw new Error('Invalid signature length');
    }

    const wire = this.concatUint8([
      this.encodeLength(compiled.signerPubkeys.length),
      Buffer.from(signature),
      compiled.message,
    ]);

    const txSignature = await this.connection.sendRawTransaction(wire, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await this.connection.confirmTransaction({
      signature: txSignature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    return txSignature;
  }


  async getEscrowAccount(owner: PublicKey): Promise<EscrowAccount | null> {
    const [escrowPDA] = this.findEscrowPDA(owner);
    try {
      // Read-only operation - use connection directly without program/signer
      const accountInfo = await this.connection.getAccountInfo(escrowPDA);
      if (!accountInfo) {
        console.log('[BeamProgram] Escrow account does not exist yet');
        return null;
      }

      console.log('[BeamProgram] Escrow account found, deserializing...');

      // Manual deserialization (robust, avoids Anchor IDL issues)
      const data = accountInfo.data;
      if (data.length < 8) {
        console.error('[BeamProgram] Account data too short');
        return null;
      }

      let offset = 8; // Skip 8-byte discriminator

      // owner: Pubkey (32 bytes)
      const ownerPubkey = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // escrow_token_account: Pubkey (32 bytes)
      const escrowTokenAccount = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      // escrow_balance: u64 (8 bytes)
      const escrowBalance = Number(data.readBigUInt64LE(offset));
      offset += 8;

      // last_nonce: u64 (8 bytes)
      const lastNonce = Number(data.readBigUInt64LE(offset));
      offset += 8;

      // reputation_score: u16 (2 bytes)
      const reputationScore = data.readUInt16LE(offset);
      offset += 2;

      // total_spent: u64 (8 bytes)
      const totalSpent = Number(data.readBigUInt64LE(offset));
      offset += 8;

      // created_at: i64 (8 bytes)
      const createdAt = Number(data.readBigInt64LE(offset));
      offset += 8;

      // bump: u8 (1 byte)
      const bump = data.readUInt8(offset);
      offset += 1;

      // BACKWARDS COMPATIBILITY: Fraud fields were added later
      // Old accounts (107 bytes): No fraud fields
      // New accounts (127 bytes): Has fraud fields (20 bytes)
      let stakeLocked = 0;
      let fraudCount = 0;
      let lastFraudTimestamp = 0;
      let needsMigration = false;

      const expectedOldSize = 8 + 32 + 32 + 8 + 8 + 2 + 8 + 8 + 1; // 107 bytes (old)
      const expectedNewSize = expectedOldSize + 8 + 4 + 8; // 127 bytes (new, +20 bytes)

      if (data.length >= expectedNewSize) {
        // New account with fraud fields
        stakeLocked = Number(data.readBigUInt64LE(offset));
        offset += 8;

        fraudCount = data.readUInt32LE(offset);
        offset += 4;

        lastFraudTimestamp = Number(data.readBigInt64LE(offset));
        needsMigration = false;

        console.log('[BeamProgram] ✅ Escrow deserialized (NEW FORMAT with fraud fields):', {
          owner: ownerPubkey.toBase58(),
          escrowBalance,
          lastNonce,
          stakeLocked,
          fraudCount,
        });
      } else if (data.length >= expectedOldSize) {
        // Old account without fraud fields - NEEDS MIGRATION!
        needsMigration = true;
        console.log('[BeamProgram] ⚠️  Escrow deserialized (OLD FORMAT, no fraud fields):', {
          owner: ownerPubkey.toBase58(),
          escrowBalance,
          lastNonce,
          needsMigration: true,
          note: 'Account created before fraud fields were added - MIGRATION REQUIRED',
        });
      } else {
        console.error('[BeamProgram] ❌ Account data size mismatch:', {
          expected: `${expectedOldSize} (old) or ${expectedNewSize} (new)`,
          actual: data.length,
        });
      }

      return {
        address: escrowPDA,
        owner: ownerPubkey,
        escrowTokenAccount,
        escrowBalance,
        lastNonce,
        reputationScore,
        totalSpent,
        createdAt,
        bump,
        stakeLocked,
        fraudCount,
        lastFraudTimestamp,
        needsMigration,
      };
    } catch (err) {
      console.error('[BeamProgram] ❌ Error fetching escrow account:', err);
      return null;
    }
  }

  /**
   * Get escrow balance (convenience method)
   * Returns 0 if escrow doesn't exist yet
   */
  async getEscrowBalance(owner: PublicKey): Promise<number> {
    const escrow = await this.getEscrowAccount(owner);
    return escrow?.escrowBalance || 0;
  }

  /**
   * Manually builds initializeEscrow instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [243, 160, 77, 153, 11, 92, 48, 209]
   * - initial_amount (8 bytes): u64 little-endian
   */
  private buildInitializeEscrowInstruction(
    escrowAccount: PublicKey,
    owner: PublicKey,
    ownerTokenAccount: PublicKey,
    escrowTokenAccount: PublicKey,
    initialAmount: number
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 82-90)
    const discriminator = Buffer.from([243, 160, 77, 153, 11, 92, 48, 209]);

    // Encode initial_amount as u64 little-endian
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(initialAmount), 0);

    // Concatenate discriminator + amount
    const data = Buffer.concat([discriminator, amountBuffer]);

    // Build accounts array according to IDL order (lines 92-137)
    const keys = [
      { pubkey: escrowAccount, isSigner: false, isWritable: true },    // escrow_account (PDA, writable)
      { pubkey: owner, isSigner: true, isWritable: true },             // owner (signer, writable - pays rent)
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true }, // owner_token_account (writable)
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true }, // escrow_token_account (writable)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  async initializeEscrow(initialAmount: number): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    try {
      console.log('[BeamProgram] initializeEscrow: Starting escrow creation...');
      console.log('[BeamProgram] Step 1: Ensuring nonce registry...');
      await this.ensureNonceRegistry();
      console.log('[BeamProgram] Step 1: ✅ Nonce registry ensured');

      console.log('[BeamProgram] Step 2: Getting owner public key...');
      const ownerPubkey = this.signer.publicKey;
      console.log(`[BeamProgram] Step 2: ✅ Owner pubkey: ${ownerPubkey.toBase58()}`);

      console.log('[BeamProgram] Step 3: Finding escrow PDA...');
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);
      console.log(`[BeamProgram] Step 3: ✅ Escrow PDA: ${escrowPDA.toBase58()}`);

      console.log('[BeamProgram] Step 4: Initializing instructions array...');
      const instructions: RawInstruction[] = [];
      console.log('[BeamProgram] Step 4: ✅ Instructions array initialized');

      // Check and create owner token account if needed
      console.log('[BeamProgram] Step 5: Deriving owner token account...');
      const ownerTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        ownerPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log(`[BeamProgram] Step 5: ✅ Owner token account: ${ownerTokenAccount.toBase58()}`);

      console.log('[BeamProgram] Step 6: Checking owner token account existence...');
      const ownerTokenInfo = await this.connection.getAccountInfo(ownerTokenAccount);
      console.log(`[BeamProgram] Step 6: ✅ Owner token info: ${ownerTokenInfo ? 'EXISTS' : 'NULL'}`);

      if (!ownerTokenInfo) {
        console.log('[BeamProgram] Step 6a: Creating owner token account instruction...');
        const ataInstruction = createAssociatedTokenAccountInstruction(
          ownerPubkey,
          ownerTokenAccount,
          ownerPubkey,
          USDC_MINT
        );
        console.log('[BeamProgram] Step 6b: Converting to RawInstruction...');
        // Convert TransactionInstruction to RawInstruction
        instructions.push({
          programId: ataInstruction.programId,
          keys: ataInstruction.keys,
          data: Buffer.from(ataInstruction.data),
        });
        console.log('[BeamProgram] Step 6c: ✅ Owner token account instruction added');
      }

      // Check and create escrow token account if needed
      console.log('[BeamProgram] Step 7: Deriving escrow token account...');
      const escrowTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        escrowPDA,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log(`[BeamProgram] Step 7: ✅ Escrow token account: ${escrowTokenAccount.toBase58()}`);
      const escrowTokenInfo = await this.connection.getAccountInfo(escrowTokenAccount);
      if (!escrowTokenInfo) {
        console.log('[BeamProgram] Creating escrow token account...');
        const ataInstruction = createAssociatedTokenAccountInstruction(
          ownerPubkey,
          escrowTokenAccount,
          escrowPDA,
          USDC_MINT
        );
        // Convert TransactionInstruction to RawInstruction
        instructions.push({
          programId: ataInstruction.programId,
          keys: ataInstruction.keys,
          data: Buffer.from(ataInstruction.data),
        });
      }

      // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
      // This avoids "Cannot read property 'size' of undefined" error in React Native/Hermes
      console.log('[BeamProgram] Building initializeEscrow instruction manually...');
      const escrowInstruction = this.buildInitializeEscrowInstruction(
        escrowPDA,
        ownerPubkey,
        ownerTokenAccount,
        escrowTokenAccount,
        initialAmount
      );

      instructions.push(escrowInstruction);

      console.log('[BeamProgram] Submitting escrow transaction...');
      const txSignature = await this.signAndBroadcast(
        ownerPubkey,
        instructions,
        'Create Escrow Account',
      );
      console.log('[BeamProgram] ✅ Escrow created successfully!', txSignature);
      return txSignature;
    } catch (err) {
      console.error('[BeamProgram] Error initializing escrow:', err);
      throw new Error(`Failed to initialize escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Manually builds settleOfflinePayment instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [48, 91, 112, 242, 39, 5, 142, 80]
   * - amount (8 bytes): u64 little-endian
   * - payer_nonce (8 bytes): u64 little-endian
   * - bundle_id (variable): string (4-byte length prefix + UTF-8 bytes)
   * - evidence (variable): SettlementEvidence struct with Options
   */
  private buildSettleOfflinePaymentInstruction(
    escrowAccount: PublicKey,
    owner: PublicKey,
    payer: PublicKey,
    merchant: PublicKey,
    escrowTokenAccount: PublicKey,
    merchantTokenAccount: PublicKey,
    nonceRegistry: PublicKey,
    amount: number,
    payerNonce: number,
    bundleId: string,
    evidence: any
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 270-278)
    const discriminator = Buffer.from([48, 91, 112, 242, 39, 5, 142, 80]);

    // Encode amount as u64 little-endian
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount), 0);

    // Encode payer_nonce as u64 little-endian
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(payerNonce), 0);

    // Encode bundle_id as string (4-byte length prefix + UTF-8)
    const bundleIdBytes = Buffer.from(bundleId, 'utf-8');
    const bundleIdLengthBuffer = Buffer.alloc(4);
    bundleIdLengthBuffer.writeUInt32LE(bundleIdBytes.length, 0);
    const bundleIdData = Buffer.concat([bundleIdLengthBuffer, bundleIdBytes]);

    // Encode SettlementEvidence struct
    // SettlementEvidence has two Option<AttestationProof> fields
    const evidenceBuffers: Buffer[] = [];

    // payer_proof: Option<AttestationProof>
    if (evidence.payerProof) {
      evidenceBuffers.push(Buffer.from([1])); // Some(T) = 1
      // AttestationProof: attestation_root (32 bytes) + attestation_nonce (32 bytes) + timestamp (8 bytes i64) + signature (64 bytes)
      evidenceBuffers.push(Buffer.from(evidence.payerProof.attestationRoot));
      evidenceBuffers.push(Buffer.from(evidence.payerProof.attestationNonce));
      const timestampBuffer = Buffer.alloc(8);
      timestampBuffer.writeBigInt64LE(BigInt(evidence.payerProof.attestationTimestamp), 0);
      evidenceBuffers.push(timestampBuffer);
      evidenceBuffers.push(Buffer.from(evidence.payerProof.verifierSignature));
    } else {
      evidenceBuffers.push(Buffer.from([0])); // None = 0
    }

    // merchant_proof: Option<AttestationProof>
    if (evidence.merchantProof) {
      evidenceBuffers.push(Buffer.from([1])); // Some(T) = 1
      evidenceBuffers.push(Buffer.from(evidence.merchantProof.attestationRoot));
      evidenceBuffers.push(Buffer.from(evidence.merchantProof.attestationNonce));
      const timestampBuffer = Buffer.alloc(8);
      timestampBuffer.writeBigInt64LE(BigInt(evidence.merchantProof.attestationTimestamp), 0);
      evidenceBuffers.push(timestampBuffer);
      evidenceBuffers.push(Buffer.from(evidence.merchantProof.verifierSignature));
    } else {
      evidenceBuffers.push(Buffer.from([0])); // None = 0
    }

    const evidenceData = Buffer.concat(evidenceBuffers);

    // Concatenate all data
    const data = Buffer.concat([
      discriminator,
      amountBuffer,
      nonceBuffer,
      bundleIdData,
      evidenceData,
    ]);

    // Build accounts array according to IDL order (lines 280-352)
    const keys = [
      { pubkey: escrowAccount, isSigner: false, isWritable: true },      // escrow_account (PDA, writable)
      { pubkey: owner, isSigner: false, isWritable: false },             // owner (readonly, relation check)
      { pubkey: payer, isSigner: true, isWritable: false },              // payer (signer)
      { pubkey: merchant, isSigner: false, isWritable: false },          // merchant (readonly)
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true }, // escrow_token_account (writable)
      { pubkey: merchantTokenAccount, isSigner: false, isWritable: true }, // merchant_token_account (writable)
      { pubkey: nonceRegistry, isSigner: false, isWritable: true },      // nonce_registry (PDA, writable)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // token_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  /**
   * CRITICAL: Settle Offline Payment
   *
   * PROGRAM VALIDATION (lib.rs lines 80-207):
   * 1. Bundle ID: 1-128 characters, non-empty
   * 2. Attestation timestamp: within 24 hours (MAX_ATTESTATION_AGE)
   * 3. Attestation root: must match computed value
   * 4. Verifier signature: Ed25519 verification against VERIFIER_PUBKEY_BYTES
   * 5. Bundle hash: not in recent_bundle_hashes (duplicate detection)
   * 6. Nonce: must be > nonce_registry.last_nonce AND > escrow_account.last_nonce
   * 7. Balance: escrow_balance >= amount
   * 8. Transfer: CPI to SPL Token program
   * 9. State update: escrow_balance (checked_sub), total_spent (checked_add), last_nonce
   * 10. History: Add to bundle_history (max 32), recent_bundle_hashes (max 16)
   *
   * PDA SEEDS:
   * - escrow_account: [b"escrow", payer.key()]
   * - nonce_registry: [b"nonce", payer.key()]
   *
   * CONSTRAINTS CHECKED:
   * - escrow_account.owner == owner (has_one relation)
   * - nonce_registry.owner == payer (verified in code)
   * - nonce_registry.owner == escrow_account.owner (has_one relation)
   * - escrow_token_account.owner == escrow_account PDA
   *
   * EVENTS EMITTED:
   * - PaymentSettled { payer, merchant, amount, nonce, bundle_id }
   * - BundleHistoryRecorded { payer, merchant, bundle_hash, amount, nonce, settled_at }
   *
   * ERROR CODES:
   * - 6000: InvalidAmount
   * - 6001: InsufficientFunds
   * - 6002: InvalidNonce
   * - 6004: InvalidOwner
   * - 6005: MissingAttestation
   * - 6006: InvalidAttestation
   * - 6007: InvalidBundleId
   * - 6008: DuplicateBundle
   * - 6013: Overflow
   * - 6014: Underflow
   */
  async settleOfflinePayment(
    merchantPubkey: PublicKey,
    amount: number,
    nonce: number,
    bundleId: string,
    evidence: SettlementEvidenceArgs
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    try {
      const payerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(payerPubkey);
      const [nonceRegistry] = this.findNonceRegistry(payerPubkey);
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);
      const merchantTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        merchantPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const preInstructions: RawInstruction[] = [];
      const merchantAccountInfo = await this.connection.getAccountInfo(merchantTokenAccount);
      if (!merchantAccountInfo) {
        // Create merchant's ATA if it doesn't exist (payer pays rent)
        const ataInstruction = createAssociatedTokenAccountInstruction(
          payerPubkey,
          merchantTokenAccount,
          merchantPubkey,
          USDC_MINT
        );
        // Convert TransactionInstruction to RawInstruction
        preInstructions.push({
          programId: ataInstruction.programId,
          keys: ataInstruction.keys,
          data: Buffer.from(ataInstruction.data),
        });
      }

      const formattedEvidence = this.formatEvidence(evidence);

      // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
      console.log('[BeamProgram] Building settleOfflinePayment instruction manually...');
      const settlementInstruction = this.buildSettleOfflinePaymentInstruction(
        escrowPDA,
        payerPubkey,  // owner
        payerPubkey,  // payer (signer)
        merchantPubkey,
        escrowTokenAccount,
        merchantTokenAccount,
        nonceRegistry,
        amount,
        nonce,
        bundleId,
        formattedEvidence
      );

      // Build transaction with pre-instructions
      const txSignature = await this.signAndBroadcast(
        payerPubkey,
        [...preInstructions, settlementInstruction],
        'Settle Offline Payment',
      );

      return txSignature;
    } catch (err) {
      console.error('Error settling offline payment:', err);
      throw new Error(`Failed to settle payment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Manually builds fundEscrow instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [155, 18, 218, 141, 182, 213, 69, 201]
   * - amount (8 bytes): u64 little-endian
   */
  private buildFundEscrowInstruction(
    escrowAccount: PublicKey,
    owner: PublicKey,
    ownerTokenAccount: PublicKey,
    escrowTokenAccount: PublicKey,
    amount: number
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 15-23)
    const discriminator = Buffer.from([155, 18, 218, 141, 182, 213, 69, 201]);

    // Encode amount as u64 little-endian
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount), 0);

    const data = Buffer.concat([discriminator, amountBuffer]);

    // Build accounts array according to IDL order (lines 25-68)
    const keys = [
      { pubkey: escrowAccount, isSigner: false, isWritable: true },      // escrow_account (PDA, writable)
      { pubkey: owner, isSigner: true, isWritable: true },               // owner (signer, writable)
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },  // owner_token_account (writable)
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true }, // escrow_token_account (writable)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // token_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  async fundEscrow(amount: number): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const ownerTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        ownerPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);

      // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
      console.log('[BeamProgram] Building fundEscrow instruction manually...');
      const instruction = this.buildFundEscrowInstruction(
        escrowPDA,
        ownerPubkey,
        ownerTokenAccount,
        escrowTokenAccount,
        amount
      );

      // Build and sign transaction manually
      const txSignature = await this.signAndBroadcast(
        ownerPubkey,
        [instruction],
        'Fund Escrow',
      );

      return txSignature;
    } catch (err) {
      console.error('Error funding escrow:', err);
      throw new Error(`Failed to fund escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Migrate old escrow account (107 bytes) to new format (127 bytes)
   * This is needed for accounts created before fraud fields were added
   */
  async migrateEscrow(): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      console.log('[BeamProgram] Building migrateEscrow instruction...');
      const instruction = this.buildMigrateEscrowInstruction(
        escrowPDA,
        ownerPubkey
      );

      // Build and sign transaction
      const txSignature = await this.signAndBroadcast(
        ownerPubkey,
        [instruction],
        'Migrate Escrow Account',
      );

      console.log('[BeamProgram] ✅ Escrow migrated successfully!', txSignature);
      return txSignature;
    } catch (err) {
      console.error('[BeamProgram] Error migrating escrow:', err);
      throw new Error(`Failed to migrate escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Manually builds migrateEscrow instruction
   *
   * Instruction format:
   * - Discriminator (8 bytes): [65, 111, 186, 119, 58, 11, 81, 209]
   * - No additional arguments
   */
  private buildMigrateEscrowInstruction(
    escrowAccount: PublicKey,
    owner: PublicKey
  ): RawInstruction {
    // Instruction discriminator from IDL (migrate_escrow)
    const discriminator = Buffer.from([65, 111, 186, 119, 58, 11, 81, 209]);

    // Build accounts array according to IDL order
    const keys = [
      { pubkey: escrowAccount, isSigner: false, isWritable: true },  // escrow_account (PDA, writable, realloc)
      { pubkey: owner, isSigner: true, isWritable: true },           // owner (signer, writable, payer for realloc)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data: discriminator, // No additional data needed
    };
  }

  /**
   * Manually builds withdrawEscrow instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [81, 84, 226, 128, 245, 47, 96, 104]
   * - amount (8 bytes): u64 little-endian
   */
  private buildWithdrawEscrowInstruction(
    escrowAccount: PublicKey,
    owner: PublicKey,
    ownerTokenAccount: PublicKey,
    escrowTokenAccount: PublicKey,
    amount: number
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 381-389)
    const discriminator = Buffer.from([81, 84, 226, 128, 245, 47, 96, 104]);

    // Encode amount as u64 little-endian
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount), 0);

    const data = Buffer.concat([discriminator, amountBuffer]);

    // Build accounts array according to IDL order (lines 391-435)
    const keys = [
      { pubkey: escrowAccount, isSigner: false, isWritable: true },      // escrow_account (PDA, writable)
      { pubkey: owner, isSigner: true, isWritable: true },               // owner (signer, writable)
      { pubkey: ownerTokenAccount, isSigner: false, isWritable: true },  // owner_token_account (writable)
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true }, // escrow_token_account (writable)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // token_program
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  async withdrawEscrow(amount: number): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const ownerTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        ownerPubkey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);

      // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
      console.log('[BeamProgram] Building withdrawEscrow instruction manually...');
      const instruction = this.buildWithdrawEscrowInstruction(
        escrowPDA,
        ownerPubkey,
        ownerTokenAccount,
        escrowTokenAccount,
        amount
      );

      // Build and sign transaction manually
      const txSignature = await this.signAndBroadcast(
        ownerPubkey,
        [instruction],
        'Withdraw from Escrow',
      );

      return txSignature;
    } catch (err) {
      console.error('Error withdrawing from escrow:', err);
      throw new Error(`Failed to withdraw from escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async getEscrowTokenAccount(escrowPDA: PublicKey): Promise<PublicKey> {
    try {
      // Prefer manual deserialization to avoid Anchor in RN
      const info = await this.connection.getAccountInfo(escrowPDA);
      if (!info) {
        throw new Error('Escrow account does not exist');
      }
      const data = info.data;
      if (data.length < 8 + 32 + 32) {
        throw new Error('Escrow account data too short');
      }
      // Skip discriminator and owner
      let offset = 8 + 32;
      return new PublicKey(data.slice(offset, offset + 32));
    } catch (err) {
      console.error('Error fetching escrow token account:', err);
      throw new Error(`Failed to get escrow token account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async isOnline(): Promise<boolean> {
    try {
      const slot = await this.connection.getSlot();
      return slot > 0;
    } catch (err) {
      console.error('Error checking connection:', err);
      return false;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const slot = await this.connection.getSlot();
      if (slot <= 0) {
        return { connected: false, programExists: false, error: 'Invalid slot number' };
      }

      const programInfo = await this.connection.getAccountInfo(PROGRAM_ID);
      if (!programInfo) {
        return { connected: true, programExists: false, error: 'Program account not found' };
      }

      return { connected: true, programExists: true };
    } catch (err) {
      console.error('Error testing connection:', err);
      return {
        connected: false,
        programExists: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getConnection(): Connection {
    return this.connection;
  }

  getProgram(): Program | null {
    return this.program;
  }

  getProgramId(): PublicKey {
    return PROGRAM_ID;
  }

  getUsdcMint(): PublicKey {
    return USDC_MINT;
  }

  async getNonceRegistry(owner: PublicKey): Promise<NonceRegistryAccount | null> {
    try {
      const [noncePda] = this.findNonceRegistry(owner);

      // Check if account exists first
      const accountInfo = await this.connection.getAccountInfo(noncePda);
      if (!accountInfo) {
        return null;
      }

      // CRITICAL FIX: Do not use Anchor Program in React Native/Hermes
      // Anchor's .fetch() method uses BufferLayout which causes "Cannot read property 'size' of undefined"
      // If we don't have a program (signer-less mode), we can't deserialize complex accounts yet
      // TODO: Implement manual deserialization for NonceRegistry if needed
      if (!this.program) {
        console.log('[BeamProgram] getNonceRegistry: No program available (read-only mode), skipping fetch');
        console.log('[BeamProgram] Returning minimal NonceRegistry with account data length');
        // Return a basic structure with default values to avoid blocking
        return {
          owner,
          lastNonce: 0,
          bundleHistory: [],
          fraudRecords: [],
        };
      }

      const account = await (this.program as any).account.nonceRegistry.fetch(noncePda);
      return {
        owner: account.owner,
        lastNonce: account.lastNonce.toNumber(),
        bundleHistory: account.bundleHistory.map((entry: any): BundleHistoryEntry => ({
          bundleHash: Buffer.from(entry.bundleHash).toString('hex'),
          merchant: new PublicKey(entry.merchant),
          amount: Number(entry.amount) / USDC_SCALE,
          settledAt: Number(entry.settledAt),
          nonce: Number(entry.nonce),
        })),
        fraudRecords: account.fraudRecords.map((entry: any): FraudRecordEntry => ({
          bundleHash: Buffer.from(entry.bundleHash).toString('hex'),
          conflictingHash: Buffer.from(entry.conflictingHash).toString('hex'),
          reporter: new PublicKey(entry.reporter),
          reportedAt: Number(entry.reportedAt),
          reason: this.parseFraudReason(entry.reason),
        })),
      };
    } catch (err) {
      console.error('Error fetching nonce registry:', err);
      return null;
    }
  }

  /**
   * Manually builds reportFraudulentBundle instruction without Anchor's BufferLayout
   *
   * Instruction format:
   * - Discriminator (8 bytes): [42, 97, 16, 195, 32, 174, 213, 89]
   * - bundle_id (variable): string (4-byte length prefix + UTF-8)
   * - conflicting_hash (32 bytes): [u8; 32]
   * - reason (variable): FraudReason enum
   */
  private buildReportFraudulentBundleInstruction(
    nonceRegistry: PublicKey,
    payer: PublicKey,
    reporter: PublicKey,
    bundleId: string,
    conflictingHash: Uint8Array,
    reason: FraudReasonKind
  ): RawInstruction {
    // Instruction discriminator from IDL (lines 200-208)
    const discriminator = Buffer.from([42, 97, 16, 195, 32, 174, 213, 89]);

    // Encode bundle_id as string (4-byte length prefix + UTF-8)
    const bundleIdBytes = Buffer.from(bundleId, 'utf-8');
    const bundleIdLengthBuffer = Buffer.alloc(4);
    bundleIdLengthBuffer.writeUInt32LE(bundleIdBytes.length, 0);
    const bundleIdData = Buffer.concat([bundleIdLengthBuffer, bundleIdBytes]);

    // Encode conflicting_hash (32 bytes)
    const conflictingHashBuffer = Buffer.from(conflictingHash);

    // Encode FraudReason enum (1-byte discriminator)
    // DuplicateBundle = 0, InvalidAttestation = 1, Other = 2
    let reasonBuffer: Buffer;
    if (reason === 'duplicateBundle') {
      reasonBuffer = Buffer.from([0]);
    } else if (reason === 'invalidAttestation') {
      reasonBuffer = Buffer.from([1]);
    } else {
      reasonBuffer = Buffer.from([2]); // 'other'
    }

    // Concatenate all data
    const data = Buffer.concat([
      discriminator,
      bundleIdData,
      conflictingHashBuffer,
      reasonBuffer,
    ]);

    // Build accounts array according to IDL order (lines 210-240)
    const keys = [
      { pubkey: nonceRegistry, isSigner: false, isWritable: true }, // nonce_registry (PDA, writable)
      { pubkey: payer, isSigner: false, isWritable: false },        // payer (readonly)
      { pubkey: reporter, isSigner: true, isWritable: false },      // reporter (signer)
    ];

    return {
      keys,
      programId: PROGRAM_ID,
      data,
    };
  }

  async reportFraudulentBundle(
    bundleId: string,
    payer: PublicKey,
    conflictingHash: Uint8Array,
    reason: FraudReasonKind
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for write operations');
    }

    const [nonceRegistry] = this.findNonceRegistry(payer);
    try {
      // CRITICAL FIX: Manually build instruction to bypass Anchor's BufferLayout serialization
      console.log('[BeamProgram] Building reportFraudulentBundle instruction manually...');
      const instruction = this.buildReportFraudulentBundleInstruction(
        nonceRegistry,
        payer,
        this.signer.publicKey,
        bundleId,
        conflictingHash,
        reason
      );

      return await this.signAndBroadcast(
        this.signer.publicKey,
        [instruction],
        'Report Fraudulent Bundle',
      );
    } catch (err) {
      console.error('Error reporting fraud evidence:', err);
      throw new Error(`Failed to report fraud evidence: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private formatEvidence(evidence: SettlementEvidenceArgs) {
    return {
      payerProof: evidence.payerProof ? this.formatProof(evidence.payerProof) : null,
      merchantProof: evidence.merchantProof ? this.formatProof(evidence.merchantProof) : null,
    };
  }

  private formatProof(proof: AttestationProofArgs) {
    return {
      attestationRoot: Array.from(proof.root),
      attestationNonce: Array.from(proof.nonce),
      attestationTimestamp: proof.timestamp,
      verifierSignature: Array.from(proof.signature),
    };
  }

  private formatFraudReason(reason: FraudReasonKind) {
    switch (reason) {
      case 'duplicateBundle':
        return { duplicateBundle: {} };
      case 'invalidAttestation':
        return { invalidAttestation: {} };
      default:
        return { other: {} };
    }
  }

  private parseFraudReason(reason: any): FraudReason {
    if (reason && 'duplicateBundle' in reason) {
      return 'duplicateBundle';
    }
    if (reason && 'invalidAttestation' in reason) {
      return 'invalidAttestation';
    }
    return 'other';
  }
}
