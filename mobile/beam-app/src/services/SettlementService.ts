/**
 * Settlement Service
 * Program ID: 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi (Devnet)
 *
 * Security checklist (engineering verification):
 * - PDA derivations and account constraints are consistent with IDL
 * - Attestation root fields and order match on-chain implementation
 * - Nonce replay protection and duplicate detection handled by program
 * - Checked arithmetic for balance updates on-chain
 *
 * Note: External audit pending. This file documents engineering checks,
 * not a third-party audit. Keep comments accurate and avoid over-claiming.
 */

import { PublicKey, Connection } from '@solana/web3.js';
import type { OfflineBundle, AttestationEnvelope, AttestationProof } from '@beam/shared';
import { verifyCompletedBundle, computeBundleHash } from '@beam/shared';
import { BeamProgramClient, type FraudReasonKind } from '../solana/BeamProgram';
import { bundleStorage } from '../storage/BundleStorage';
import { Config } from '../config';
import bs58 from 'bs58';
import { attestationService, type AttestedBundle } from './AttestationService';
import type { BeamSigner } from '../wallet/WalletManager';
import { Buffer } from 'buffer';
import type { NonceRegistryAccount } from '../solana/types';
import { sha256 } from '@noble/hashes/sha256';
import { createModuleLogger } from './Logger';

const Logger = createModuleLogger('SettlementService');

type SettlementInput = OfflineBundle | AttestedBundle;

interface VerifierProofs {
  payer: AttestationProof;
  merchant?: AttestationProof;
}

function unwrapBundle(input: SettlementInput): {
  bundle: OfflineBundle;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
} {
  if ((input as AttestedBundle).bundle) {
    const attested = input as AttestedBundle;
    return {
      bundle: attested.bundle,
      payerAttestation: attested.payerAttestation,
      merchantAttestation: attested.merchantAttestation,
    };
  }

  return { bundle: input as OfflineBundle };
}

export class SettlementService {
  private beamClient: BeamProgramClient | null = null;
  private connection: Connection;
  private readonly networkTimeout = 30000; // 30 seconds timeout for network calls

  constructor() {
    this.connection = new Connection(Config.solana.rpcUrl, Config.solana.commitment);
  }

  /**
   * Helper to add timeout to network calls
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number = this.networkTimeout): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Network request timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  initializeClient(signer: BeamSigner): void {
    this.beamClient = new BeamProgramClient(Config.solana.rpcUrl, signer);
    this.connection = this.beamClient.getConnection();
  }

  /**
   * CRITICAL: Settlement Transaction Flow
   *
   * VERIFICATION CHECKLIST:
   * ✓ 1. Nonce registry initialized and accessible
   * ✓ 2. Payer signature matches signer public key
   * ✓ 3. Bundle signatures verified (both payer and merchant)
   * ✓ 4. Payer attestation proof required
   * ✓ 5. Merchant attestation proof optional
   * ✓ 6. Verifier service validates attestations
   * ✓ 7. Program verifies attestation root computation
   * ✓ 8. Nonce > last_nonce (replay protection)
   * ✓ 9. Bundle hash not in recent_bundle_hashes (duplicate detection)
   * ✓ 10. Sufficient escrow balance
   * ✓ 11. Token transfer from escrow to merchant
   * ✓ 12. Escrow and nonce registry state updated atomically
   * ✓ 13. Bundle history recorded (max 32 entries)
   * ✓ 14. Events emitted for monitoring
   *
   * PROGRAM VALIDATION (lib.rs lines 79-208):
   * - Bundle ID length: 1-128 characters
   * - Attestation timestamp: within 24 hours
   * - Nonce: must be > nonce_registry.last_nonce AND > escrow_account.last_nonce
   * - Balance: checked_sub prevents underflow
   * - Total spent: checked_add prevents overflow
   */
  async settleBundleOnchain(input: SettlementInput, signer: BeamSigner): Promise<{ signature: string; bundleId: string }> {
    if (!this.beamClient) {
      this.initializeClient(signer);
    }

    const { bundle, payerAttestation, merchantAttestation } = unwrapBundle(input);

    // SECURITY: Verify payer matches signer (prevent unauthorized settlement)
    if (bundle.payer_pubkey !== signer.publicKey.toBase58()) {
      throw new Error('Bundle payer does not match signer');
    }

    const payerPubkey = bs58.decode(bundle.payer_pubkey);
    const merchantPubkey = bs58.decode(bundle.merchant_pubkey);

    // SECURITY: Verify bundle signatures before on-chain submission
    const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkey);
    if (!verification.payerValid || !verification.merchantValid) {
      throw new Error('Invalid signatures on bundle');
    }

    // SECURITY: Payer attestation is mandatory for settlement
    if (!payerAttestation) {
      throw new Error('Missing payer attestation');
    }

    // CRITICAL: Verifier service validates attestations and returns signed proofs
    const proofs = await this.verifyWithService(bundle, payerAttestation, merchantAttestation);

    // Always use server settlement for RN reliability and proper devnet flow
    const signature = await this.settleViaServer(bundle, proofs);

    await bundleStorage.removeBundle(bundle.tx_id).catch(() => { });
    return { signature, bundleId: bundle.tx_id };
  }

  /**
   * Server-side settlement submission. Backend crafts and submits the TX.
   */
  private async settleViaServer(
    bundle: OfflineBundle,
    proofs: { payer: AttestationProof; merchant?: AttestationProof }
  ): Promise<string> {
    const endpoint = Config.services?.verifier;
    if (!endpoint) {
      throw new Error('Verifier service endpoint not configured');
    }
    const url = `${endpoint}/settle-offline`;
    const payload = {
      bundleId: bundle.tx_id,
      bundleSummary: {
        amount: bundle.token.amount,
        nonce: bundle.nonce,
        payer: bundle.payer_pubkey,
        merchant: bundle.merchant_pubkey,
        symbol: bundle.token.symbol,
      },
      proofs: {
        payer: {
          root: Buffer.from(proofs.payer.root).toString('base64'),
          nonce: Buffer.from(proofs.payer.nonce).toString('base64'),
          timestamp: proofs.payer.timestamp,
          signature: Buffer.from(proofs.payer.signature).toString('base64'),
        },
        merchant: proofs.merchant
          ? {
            root: Buffer.from(proofs.merchant.root).toString('base64'),
            nonce: Buffer.from(proofs.merchant.nonce).toString('base64'),
            timestamp: proofs.merchant.timestamp,
            signature: Buffer.from(proofs.merchant.signature).toString('base64'),
          }
          : undefined,
      },
    };

    const resp = await this.withTimeout(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      30000
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Server settlement failed: ${resp.status} ${text}`);
    }
    const json = await resp.json().catch(() => ({} as any));
    const sig = json.signature || json.tx || json.result?.signature;
    if (!sig) {
      throw new Error('Server settlement did not return a signature');
    }
    return String(sig);
  }

  async settleAllPending(signer: BeamSigner): Promise<{ success: { signature: string; bundleId: string }[]; failed: string[] }> {
    if (!this.beamClient) {
      this.initializeClient(signer);
    }

    const results = { success: [] as { signature: string; bundleId: string }[], failed: [] as string[] };

    const signerAddress = signer.publicKey.toBase58();
    const attestedBundles = (await attestationService.loadBundles()).filter(
      attested => attested.bundle.payer_pubkey === signerAddress
    );

    for (const attested of attestedBundles) {
      try {
        const settlement = await this.settleBundleOnchain(attested, signer);
        results.success.push(settlement);
      } catch (err) {
        if (__DEV__) {
          console.error(`Failed to settle ${attested.bundle.tx_id}:`, err);
        }
        results.failed.push(attested.bundle.tx_id);
      }
    }

    return results;
  }

  async isOnline(): Promise<boolean> {
    try {
      const { blockhash } = await this.withTimeout(
        this.connection.getLatestBlockhash('processed'),
        5000 // 5 second timeout for connectivity check
      );
      return Boolean(blockhash);
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to reach Solana RPC:', err);
      }
      return false;
    }
  }

  async getEscrowBalance(owner: PublicKey): Promise<number> {
    if (!this.beamClient) return 0;
    const escrow = await this.beamClient.getEscrowAccount(owner);
    return escrow?.escrowBalance || 0;
  }

  async getNonceRegistrySnapshot(owner: PublicKey, signer: BeamSigner): Promise<NonceRegistryAccount | null> {
    if (!this.beamClient) {
      this.initializeClient(signer);
    }
    return this.beamClient!.getNonceRegistry(owner);
  }

  async reportFraudEvidence(
    bundle: OfflineBundle,
    signer: BeamSigner,
    reason: FraudReasonKind
  ): Promise<string> {
    if (!this.beamClient) {
      this.initializeClient(signer);
    }

    const payer = new PublicKey(bundle.payer_pubkey);
    const hash = computeBundleHash(bundle);
    return this.beamClient!.reportFraudulentBundle(bundle.tx_id, payer, hash, reason);
  }

  /**
   * Direct online payment WITHOUT attestation
   * For online payments only - skips hardware attestation
   * Uses the updated Solana program that accepts optional attestation
   */
  async settleDirectPaymentOnline(
    merchantPubkey: PublicKey,
    amount: number,
    signer: BeamSigner
  ): Promise<string> {
    try {
      Logger.info('SettlementService', 'Starting direct online payment (no attestation)');

      if (!this.beamClient) {
        this.initializeClient(signer);
      }

      const payerPubkey = signer.publicKey;

      // Ensure nonce registry exists
      await this.beamClient!.ensureNonceRegistry();

      // Get current nonce and increment
      const nonceRegistry = await this.beamClient!.getNonceRegistry(payerPubkey);
      const nonce = (nonceRegistry?.lastNonce || 0) + 1;

      // Generate unique bundle ID
      const bundleId = `online-${Date.now()}-${nonce}`;

      // Create evidence with NO attestation (program now accepts optional)
      const evidence = {
        payerProof: null,
        merchantProof: null,
      };

      Logger.info('SettlementService', `Settling online payment: ${bundleId}`);

      // Call Solana program (updated to accept optional attestation)
      const signature = await this.beamClient!.settleOfflinePayment(
        merchantPubkey,
        amount,
        nonce,
        bundleId,
        evidence
      );

      Logger.info('SettlementService', `Online payment settled: ${signature}`);

      return signature;
    } catch (error) {
      Logger.error('SettlementService', 'Failed to settle online payment', error);
      throw error;
    }
  }

  // SECURITY: Removed deprecated methods that used hardcoded test keys:
  // - settleDirectPayment() - used fake attestation
  // - createDirectAttestationProof() - created fake proofs
  // - computeAttestationRoot() - not needed for online payments
  // - signMessage() - contained HARDCODED TEST_VERIFIER_PRIVATE_KEY
  // All offline payments now properly use the verifier service for real attestations

  async settleMerchantBundles(
    merchantSigner: BeamSigner,
    bundles: AttestedBundle[]
  ): Promise<{ success: { signature: string; bundleId: string }[]; failed: string[] }> {
    this.initializeClient(merchantSigner);
    await this.beamClient!.ensureNonceRegistry();

    const results = { success: [] as { signature: string; bundleId: string }[], failed: [] as string[] };

    for (const attested of bundles) {
      const { bundle, payerAttestation, merchantAttestation } = unwrapBundle(attested);

      try {
        if (bundle.merchant_pubkey !== merchantSigner.publicKey.toBase58()) {
          continue;
        }

        if (!payerAttestation) {
          throw new Error('Missing payer attestation');
        }

        if (!merchantAttestation) {
          throw new Error('Missing merchant attestation');
        }

        const payerPubkey = bs58.decode(bundle.payer_pubkey);
        const merchantPubkey = bs58.decode(bundle.merchant_pubkey);

        const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkey);
        if (!verification.payerValid || !verification.merchantValid) {
          if (__DEV__) {
            console.error(`Bundle ${bundle.tx_id} has invalid signatures`);
          }
          results.failed.push(bundle.tx_id);
          continue;
        }

        const proofs = await this.verifyWithService(bundle, payerAttestation, merchantAttestation);

        const settlement = await this.beamClient!.settleOfflinePayment(
          merchantSigner.publicKey,
          bundle.token.amount,
          bundle.nonce,
          bundle.tx_id,
          {
            payerProof: proofs.payer,
            merchantProof: proofs.merchant,
          }
        );

        results.success.push({ signature: settlement, bundleId: bundle.tx_id });
        if (__DEV__) {
          console.log(`Merchant settled bundle ${bundle.tx_id}: ${settlement}`);
        }
      } catch (err) {
        if (__DEV__) {
          console.error(`Failed to settle bundle ${bundle.tx_id}:`, err);
        }
        results.failed.push(bundle.tx_id);
      }
    }

    return results;
  }

  /**
   * CRITICAL: Verifier Service Integration
   *
   * ATTESTATION VERIFICATION FLOW:
   * 1. Client sends attestation envelopes to verifier service
   * 2. Verifier validates Play Integrity JWT or Key Attestation certificates
   * 3. Verifier computes attestation root using same algorithm as program
   * 4. Verifier signs the attestation root with Ed25519 private key
   * 5. Client receives signed proofs for submission to program
   *
   * ATTESTATION ROOT COMPUTATION (MUST MATCH PROGRAM):
   * - Prefix: "beam.attestation.v1"
   * - Components (in order):
   *   1. bundle_id (UTF-8 bytes)
   *   2. payer pubkey (32 bytes)
   *   3. merchant pubkey (32 bytes)
   *   4. amount (u64 little-endian)
   *   5. bundle_nonce (u64 little-endian)
   *   6. role byte (0=payer, 1=merchant)
   *   7. attestation_nonce (32 bytes)
   *   8. attestation_timestamp (i64 little-endian)
   * - Hash: SHA256
   *
   * VERIFIER SIGNATURE VALIDATION (program/src/attestation.rs lines 43-85):
   * - Uses Ed25519 signature scheme
   * - Verifier public key: hardcoded in program (VERIFIER_PUBKEY_BYTES)
   * - Signature: 64 bytes
   * - Message: attestation root (32 bytes)
   *
   * SECURITY CONSIDERATIONS:
   * ✓ 20-second timeout prevents indefinite hangs
   * ✓ Endpoint configuration required
   * ✓ Error responses handled gracefully
   * ✓ Valid response must have valid=true and payer proof
   * ✓ Merchant proof is optional (single-party settlement supported)
   */
  private async verifyWithService(
    bundle: OfflineBundle,
    payer: AttestationEnvelope,
    merchant?: AttestationEnvelope
  ): Promise<VerifierProofs> {
    const endpoint = Config.services?.verifier;
    if (!endpoint) {
      throw new Error('Verifier service endpoint not configured');
    }

    try {
      const response = await this.withTimeout(
        fetch(`${endpoint}/verify-attestation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bundleId: bundle.tx_id,
            bundleSummary: {
              amount: bundle.token.amount,
              nonce: bundle.nonce,
              payer: bundle.payer_pubkey,
              merchant: bundle.merchant_pubkey,
            },
            payerAttestation: this.serializeForApi(payer),
            merchantAttestation: merchant ? this.serializeForApi(merchant) : undefined,
          }),
        }),
        20000 // 20 second timeout for verifier API calls
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Verifier responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data?.valid !== true || !data?.proofs?.payer) {
        throw new Error('Verifier rejected attestation payload');
      }

      return {
        payer: this.parseProof(data.proofs.payer),
        merchant: data.proofs.merchant ? this.parseProof(data.proofs.merchant) : undefined,
      };
    } catch (err) {
      if (__DEV__) {
        console.error('Attestation verification service failed', err);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private parseProof(raw: { root: string; nonce: string; timestamp: number; signature: string }): AttestationProof {
    return {
      root: Buffer.from(raw.root, 'base64'),
      nonce: Buffer.from(raw.nonce, 'base64'),
      timestamp: Number(raw.timestamp),
      signature: Buffer.from(raw.signature, 'base64'),
    };
  }

  private serializeForApi(envelope: AttestationEnvelope) {
    return {
      bundleId: envelope.bundleId,
      timestamp: envelope.timestamp,
      nonce: Buffer.from(envelope.nonce).toString('base64'),
      attestationReport: Buffer.from(envelope.attestationReport).toString('base64'),
      signature: Buffer.from(envelope.signature).toString('base64'),
      certificateChain: envelope.certificateChain.map(entry => Buffer.from(entry).toString('base64')),
      deviceInfo: envelope.deviceInfo,
    };
  }
}
