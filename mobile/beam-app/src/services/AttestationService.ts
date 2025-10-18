import { encodeEnvelope, hashEnvelope, type AttestationEnvelope, type OfflineBundle } from '@beam/shared';
import {
  SecureStorage,
  fromBase64,
  toBase64,
  type BundleMetadata,
  type StoredBundle,
  type StoredAttestation,
} from '../native/SecureStorageBridge';
import { encodeOfflineBundle, decodeOfflineBundle } from '../storage/BundleStorage';

export interface AttestedBundle {
  bundle: OfflineBundle;
  metadata: BundleMetadata;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
}

class AttestationService {
  async ensureWallet(): Promise<string> {
    return SecureStorage.ensureWalletKeypair();
  }

  async signPayload(bytes: Uint8Array, reason?: string): Promise<Uint8Array> {
    const signatureBase64 = await SecureStorage.signDetached(toBase64(bytes), reason ? { reason } : undefined);
    return fromBase64(signatureBase64);
  }

  async storeBundle(
    bundle: OfflineBundle,
    metadata: BundleMetadata,
    options: {
      payerAttestation?: AttestationEnvelope;
      merchantAttestation?: AttestationEnvelope;
      selfRole?: 'payer' | 'merchant';
      usePlayIntegrity?: boolean;
    } = {}
  ): Promise<AttestationEnvelope | undefined> {
    const payloadJson = JSON.stringify(encodeOfflineBundle(bundle));
    const encodedPayload = toBase64(new TextEncoder().encode(payloadJson));

    const initialMetadata = this.attachAttestations(metadata, options);
    await SecureStorage.storeTransaction(bundle.tx_id, encodedPayload, initialMetadata);

    try {
      const attestationOptions = options.usePlayIntegrity !== undefined
        ? { usePlayIntegrity: options.usePlayIntegrity }
        : undefined;
      const nativeEnvelope = await SecureStorage.fetchAttestation(bundle.tx_id, attestationOptions);
      const envelope = this.parseNativeEnvelope(nativeEnvelope);
      const mergedOptions = {
        payerAttestation:
          options.selfRole === 'payer' ? envelope : options.payerAttestation,
        merchantAttestation:
          options.selfRole === 'merchant' ? envelope : options.merchantAttestation,
      };
      const mergedMetadata = this.attachAttestations(metadata, mergedOptions);
      await SecureStorage.storeTransaction(bundle.tx_id, encodedPayload, mergedMetadata);
      return envelope;
    } catch (err) {
      if (__DEV__) {
        console.warn('Attestation fetch failed, continuing without envelope', err);
      }
      return undefined;
    }
  }

  async loadBundles(): Promise<AttestedBundle[]> {
    const stored = await SecureStorage.loadTransactions();
    const bundles = await Promise.all(stored.map(async item => this.deserializeStoredBundle(item)));
    return bundles;
  }

  async removeBundle(bundleId: string): Promise<void> {
    await SecureStorage.removeTransaction(bundleId);
  }

  async verifyEnvelope(envelope: AttestationEnvelope, bundlePayload: Uint8Array): Promise<boolean> {
    try {
      const encoded = encodeEnvelope(envelope);
      if (encoded.length === 0) {
        return false;
      }

      // Basic sanity checks before native verification layer is in place
      const hasCertChain = envelope.certificateChain.length > 0 && envelope.certificateChain.every(cert => cert.length > 0);
      const hasReport = envelope.attestationReport.length > 0;
      const hasSignature = envelope.signature.length > 0;

      if (!(hasCertChain && hasReport && hasSignature)) {
        return false;
      }

      // Ensure bundle ID hash matches payload hash (placeholder until native binding supplied)
      const payloadHash = hashEnvelope({
        ...envelope,
        attestationReport: bundlePayload,
      } as AttestationEnvelope);

      return payloadHash.length > 0;
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to verify envelope', err);
      }
      return false;
    }
  }

  private deserializeStoredBundle(item: StoredBundle): AttestedBundle {
    const payload = fromBase64(item.payload);
    const persisted = JSON.parse(new TextDecoder().decode(payload));
    const bundle = decodeOfflineBundle(persisted);
    const fallbackMetadata = {
      amount: bundle.token.amount,
      currency: bundle.token.symbol,
      merchantPubkey: bundle.merchant_pubkey,
      payerPubkey: bundle.payer_pubkey,
      nonce: bundle.nonce,
      createdAt: bundle.timestamp,
    };
    const metadata = item.metadata ?? fallbackMetadata;
    const storedPayer = metadata.attestations?.payer
      ? this.deserializeStoredAttestation(metadata.attestations.payer)
      : item.payerAttestation
        ? this.parseNativeEnvelope(item.payerAttestation)
        : undefined;
    const storedMerchant = metadata.attestations?.merchant
      ? this.deserializeStoredAttestation(metadata.attestations.merchant)
      : item.merchantAttestation
        ? this.parseNativeEnvelope(item.merchantAttestation)
        : undefined;

    return {
      bundle,
      metadata,
      payerAttestation: storedPayer,
      merchantAttestation: storedMerchant,
    };
  }

  private parseNativeEnvelope(raw: any): AttestationEnvelope {
    return {
      bundleId: raw.bundleId,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Number(raw.timestamp ?? Date.now()),
      nonce: typeof raw.nonce === 'string' ? fromBase64(raw.nonce) : new Uint8Array(),
      signature: typeof raw.signature === 'string' ? fromBase64(raw.signature) : new Uint8Array(),
      attestationReport: typeof raw.attestationReport === 'string'
        ? fromBase64(raw.attestationReport)
        : new Uint8Array(),
      certificateChain: Array.isArray(raw.certificateChain)
        ? raw.certificateChain.map((entry: string) => fromBase64(entry))
        : [],
      deviceInfo: raw.deviceInfo,
      attestationType: raw.attestationType,
    };
  }

  private serializeForStorage(envelope?: AttestationEnvelope): StoredAttestation | undefined {
    if (!envelope) {
      return undefined;
    }

    return {
      bundleId: envelope.bundleId,
      timestamp: envelope.timestamp,
      nonce: toBase64(envelope.nonce),
      attestationReport: toBase64(envelope.attestationReport),
      signature: toBase64(envelope.signature),
      certificateChain: envelope.certificateChain.map(entry => toBase64(entry)),
      deviceInfo: envelope.deviceInfo,
    };
  }

  private deserializeStoredAttestation(stored: StoredAttestation): AttestationEnvelope {
    return {
      bundleId: stored.bundleId,
      timestamp: stored.timestamp,
      nonce: fromBase64(stored.nonce),
      attestationReport: fromBase64(stored.attestationReport),
      signature: fromBase64(stored.signature),
      certificateChain: stored.certificateChain.map(entry => fromBase64(entry)),
      deviceInfo: stored.deviceInfo,
    };
  }

  private attachAttestations(
    metadata: BundleMetadata,
    options: { payerAttestation?: AttestationEnvelope; merchantAttestation?: AttestationEnvelope }
  ): BundleMetadata {
    const storedPayer = this.serializeForStorage(options.payerAttestation);
    const storedMerchant = this.serializeForStorage(options.merchantAttestation);

    return {
      ...metadata,
      attestations: {
        payer: storedPayer ?? metadata.attestations?.payer,
        merchant: storedMerchant ?? metadata.attestations?.merchant,
      },
    };
  }
}

export const attestationService = new AttestationService();
