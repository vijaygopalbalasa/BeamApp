import { PublicKey, Connection } from '@solana/web3.js';
import type { OfflineBundle, AttestationEnvelope, AttestationProof } from '@beam/shared';
import { verifyCompletedBundle, computeBundleHash } from '@beam/shared';
import { BeamProgramClient, type FraudReasonKind } from '../solana/BeamProgram';
import { bundleStorage } from '../storage/BundleStorage';
import { Config } from '../config';
import * as bs58 from 'bs58';
import { attestationService, type AttestedBundle } from './AttestationService';
import type { BeamSigner } from '../wallet/WalletManager';
import { Buffer } from 'buffer';
import type { NonceRegistryAccount } from '../solana/types';

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

  async settleBundleOnchain(input: SettlementInput, signer: BeamSigner): Promise<{ signature: string; bundleId: string }> {
    if (!this.beamClient) {
      this.initializeClient(signer);
    }

    await this.beamClient!.ensureNonceRegistry();

    const { bundle, payerAttestation, merchantAttestation } = unwrapBundle(input);

    if (bundle.payer_pubkey !== signer.publicKey.toBase58()) {
      throw new Error('Bundle payer does not match signer');
    }

    const payerPubkey = bs58.decode(bundle.payer_pubkey);
    const merchantPubkey = bs58.decode(bundle.merchant_pubkey);

    const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkey);
    if (!verification.payerValid || !verification.merchantValid) {
      throw new Error('Invalid signatures on bundle');
    }

    if (!payerAttestation) {
      throw new Error('Missing payer attestation');
    }

    const merchantPubkeyObj = new PublicKey(bundle.merchant_pubkey);

    const proofs = await this.verifyWithService(bundle, payerAttestation, merchantAttestation);

    const tx = await this.beamClient!.settleOfflinePayment(
      merchantPubkeyObj,
      bundle.token.amount,
      bundle.nonce,
      bundle.tx_id,
      {
        payerProof: proofs.payer,
        merchantProof: proofs.merchant,
      }
    );

    await bundleStorage.removeBundle(bundle.tx_id).catch(() => {
      // Bundle may not exist in legacy storage when using secure storage only
    });

    return { signature: tx, bundleId: bundle.tx_id };
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
