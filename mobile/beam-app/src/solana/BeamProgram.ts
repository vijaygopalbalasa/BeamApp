/**
 * BEAM PROGRAM CLIENT - COMPREHENSIVE DOCUMENTATION
 *
 * PROGRAM OVERVIEW:
 * - Program ID: 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi
 * - Network: Solana Devnet
 * - Deployed Slot: 415476588
 * - Purpose: Offline-first P2P payments with escrow and attestation verification
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

import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction, VersionedTransaction, Commitment } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Wallet, Idl } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
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
  payerProof: AttestationProofArgs;
  merchantProof?: AttestationProofArgs;
}

export type FraudReasonKind = FraudReason;

export class BeamProgramClient {
  private readonly connection: Connection;
  private readonly program: Program | null;
  private readonly provider: AnchorProvider | null;
  private readonly signer: BeamSigner | null;

  constructor(rpcUrlOrConnection: string | Connection = Config.solana.rpcUrl, signer?: BeamSigner) {
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
      // Full mode with signer for write operations. Avoid in RN for read-only.
      const anchorWallet: any = {
        publicKey: signer.publicKey,
        signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
          const anyTx: any = tx as any;
          if (typeof anyTx.serializeMessage === 'function') {
            const message = anyTx.serializeMessage();
            const signature = await signer.sign(message, 'Authorize Solana transaction');
            if (typeof anyTx.addSignature === 'function') {
              anyTx.addSignature(signer.publicKey, Buffer.from(signature));
            }
          }
          return tx as T;
        },
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
          for (const t of txs as any[]) {
            if (typeof t.serializeMessage === 'function') {
              const message = t.serializeMessage();
              const signature = await signer.sign(message, 'Authorize Solana transaction');
              if (typeof t.addSignature === 'function') {
                t.addSignature(signer.publicKey, Buffer.from(signature));
              }
            }
          }
          return txs as T[];
        },
      };

      this.provider = new (AnchorProvider as any)(this.connection, anchorWallet, {
        commitment: Config.solana.commitment,
      }) as any;
      this.program = new (Program as any)(BeamIDL as Idl, PROGRAM_ID, this.provider as any) as any;
    } else {
      // Read-only mode: avoid constructing Anchor Provider/Program to prevent RN runtime issues
      this.provider = null;
      this.program = null;
    }
  }

  async ensureNonceRegistry(): Promise<void> {
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    const [nonceRegistry] = this.findNonceRegistry(this.signer.publicKey);
    const account = await this.connection.getAccountInfo(nonceRegistry);
    if (account) {
      return;
    }

    await this.program.methods
      .initializeNonceRegistry()
      .accounts({
        payer: this.signer.publicKey,
        nonceRegistry,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  findEscrowPDA(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('escrow'), owner.toBuffer()], PROGRAM_ID);
  }

  findNonceRegistry(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('nonce'), owner.toBuffer()], PROGRAM_ID);
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

      console.log('[BeamProgram] ✅ Escrow deserialized successfully:', {
        owner: ownerPubkey.toBase58(),
        escrowBalance,
        lastNonce,
      });

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

  async initializeEscrow(initialAmount: number): Promise<string> {
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    try {
      await this.ensureNonceRegistry();

      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const preInstructions: TransactionInstruction[] = [];

      const ownerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, ownerPubkey);
      const ownerTokenInfo = await this.connection.getAccountInfo(ownerTokenAccount);
      if (!ownerTokenInfo) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            ownerPubkey,
            ownerTokenAccount,
            ownerPubkey,
            USDC_MINT
          )
        );
      }

      const escrowTokenAccount = await getAssociatedTokenAddress(USDC_MINT, escrowPDA, true);
      const escrowTokenInfo = await this.connection.getAccountInfo(escrowTokenAccount);
      if (!escrowTokenInfo) {
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            ownerPubkey,
            escrowTokenAccount,
            escrowPDA,
            USDC_MINT
          )
        );
      }

      const tx = await this.program.methods
        .initializeEscrow(new BN(initialAmount))
        .accounts({
          escrowAccount: escrowPDA,
          owner: ownerPubkey,
          ownerTokenAccount,
          escrowTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions(preInstructions)
        .rpc();

      return tx;
    } catch (err) {
      console.error('Error initializing escrow:', err);
      throw new Error(`Failed to initialize escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    try {
      const payerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(payerPubkey);
      const [nonceRegistry] = this.findNonceRegistry(payerPubkey);
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);
      const merchantTokenAccount = await getAssociatedTokenAddress(USDC_MINT, merchantPubkey);

      const preInstructions = [];
      const merchantAccountInfo = await this.connection.getAccountInfo(merchantTokenAccount);
      if (!merchantAccountInfo) {
        // Create merchant's ATA if it doesn't exist (payer pays rent)
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            payerPubkey,
            merchantTokenAccount,
            merchantPubkey,
            USDC_MINT
          )
        );
      }

      const formattedEvidence = this.formatEvidence(evidence);

      const tx = await this.program.methods
        .settleOfflinePayment(new BN(amount), new BN(nonce), bundleId, formattedEvidence)
        .accounts({
          escrowAccount: escrowPDA,
          owner: payerPubkey,
          payer: payerPubkey,
          merchant: merchantPubkey,
          escrowTokenAccount,
          merchantTokenAccount,
          nonceRegistry,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .rpc();

      return tx;
    } catch (err) {
      console.error('Error settling offline payment:', err);
      throw new Error(`Failed to settle payment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async fundEscrow(amount: number): Promise<string> {
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const ownerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, ownerPubkey);
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);

      const tx = await this.program.methods
        .fundEscrow(new BN(amount))
        .accounts({
          escrowAccount: escrowPDA,
          owner: ownerPubkey,
          ownerTokenAccount,
          escrowTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return tx;
    } catch (err) {
      console.error('Error funding escrow:', err);
      throw new Error(`Failed to fund escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async withdrawEscrow(amount: number): Promise<string> {
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const ownerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, ownerPubkey);
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);

      const tx = await this.program.methods
        .withdrawEscrow(new BN(amount))
        .accounts({
          escrowAccount: escrowPDA,
          owner: ownerPubkey,
          ownerTokenAccount,
          escrowTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return tx;
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

      // Use program if available, otherwise create temp program
      let programToUse = this.program;
      if (!programToUse) {
        const Program = require('@coral-xyz/anchor').Program;
        programToUse = new Program(BeamIDL as Idl, { connection: this.connection } as any, PROGRAM_ID);
      }

      const account = await (programToUse as any).account.nonceRegistry.fetch(noncePda);
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

  async reportFraudulentBundle(
    bundleId: string,
    payer: PublicKey,
    conflictingHash: Uint8Array,
    reason: FraudReasonKind
  ): Promise<string> {
    if (!this.signer || !this.program) {
      throw new Error('Signer required for write operations');
    }

    const [nonceRegistry] = this.findNonceRegistry(payer);
    const reasonArg = this.formatFraudReason(reason);
    try {
      const tx = await this.program.methods
        .reportFraudulentBundle(bundleId, Array.from(conflictingHash), reasonArg)
        .accounts({
          nonceRegistry,
          payer,
          reporter: this.signer.publicKey,
        })
        .rpc();
      return tx;
    } catch (err) {
      console.error('Error reporting fraud evidence:', err);
      throw new Error(`Failed to report fraud evidence: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private formatEvidence(evidence: SettlementEvidenceArgs) {
    return {
      payerProof: this.formatProof(evidence.payerProof),
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
