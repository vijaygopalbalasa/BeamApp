import { Connection, PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
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
  private readonly program: Program;
  private readonly provider: AnchorProvider;
  private readonly signer: BeamSigner;

  constructor(rpcUrl: string = Config.solana.rpcUrl, signer: BeamSigner) {
    this.connection = new Connection(rpcUrl, Config.solana.commitment);
    this.signer = signer;

    const anchorWallet: Wallet = {
      publicKey: signer.publicKey,
      signTransaction: async (tx: Transaction) => {
        const message = tx.serializeMessage();
        const signature = await signer.sign(message, 'Authorize Solana transaction');
        tx.addSignature(signer.publicKey, Buffer.from(signature));
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        for (const tx of txs) {
          const message = tx.serializeMessage();
          const signature = await signer.sign(message, 'Authorize Solana transaction');
          tx.addSignature(signer.publicKey, Buffer.from(signature));
        }
        return txs;
      },
    };

    this.provider = new AnchorProvider(this.connection, anchorWallet, {
      commitment: Config.solana.commitment,
    });

    this.program = new Program(BeamIDL as Idl, this.provider);
  }

  async ensureNonceRegistry(): Promise<void> {
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
      const account = await this.program.account.offlineEscrowAccount.fetch(escrowPDA);
      return {
        address: escrowPDA,
        owner: account.owner,
        escrowTokenAccount: account.escrowTokenAccount,
        escrowBalance: account.escrowBalance.toNumber(),
        lastNonce: account.lastNonce.toNumber(),
        reputationScore: account.reputationScore,
        totalSpent: account.totalSpent.toNumber(),
        createdAt: account.createdAt.toNumber(),
        bump: account.bump,
      };
    } catch (err) {
      console.error('Error fetching escrow account:', err);
      return null;
    }
  }

  async initializeEscrow(initialAmount: number): Promise<string> {
    try {
      const ownerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(ownerPubkey);

      const ownerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, ownerPubkey);
      const escrowTokenAccount = Keypair.generate();

      const tx = await this.program.methods
        .initializeEscrow(new BN(initialAmount))
        .accounts({
          escrowAccount: escrowPDA,
          owner: ownerPubkey,
          ownerTokenAccount,
          escrowTokenAccount: escrowTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([escrowTokenAccount])
        .rpc();

      return tx;
    } catch (err) {
      console.error('Error initializing escrow:', err);
      throw new Error(`Failed to initialize escrow: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async settleOfflinePayment(
    merchantPubkey: PublicKey,
    amount: number,
    nonce: number,
    bundleId: string,
    evidence: SettlementEvidenceArgs
  ): Promise<string> {
    try {
      const payerPubkey = this.signer.publicKey;
      const [escrowPDA] = this.findEscrowPDA(payerPubkey);
      const [nonceRegistry] = this.findNonceRegistry(payerPubkey);
      const escrowTokenAccount = await this.getEscrowTokenAccount(escrowPDA);
      const merchantTokenAccount = await getAssociatedTokenAddress(USDC_MINT, merchantPubkey);

      const preInstructions = [];
      const merchantAccountInfo = await this.connection.getAccountInfo(merchantTokenAccount);
      if (!merchantAccountInfo) {
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
      const escrowAccount = await this.program.account.offlineEscrowAccount.fetch(escrowPDA);
      return escrowAccount.escrowTokenAccount;
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

  getProgram(): Program {
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
      const account = await this.program.account.nonceRegistry.fetch(noncePda);
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
