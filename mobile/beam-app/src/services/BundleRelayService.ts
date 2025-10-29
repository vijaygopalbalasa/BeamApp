/**
 * Bundle Relay Service
 *
 * Provides store-and-forward relay functionality for offline payment bundles.
 * This service acts as a pseudo-mesh network by using the verifier backend
 * as a relay point between customers and merchants.
 *
 * Architecture:
 * - Customers upload unsigned bundles to verifier when online
 * - Merchants poll for bundles addressed to them
 * - Merchants sign and re-upload bundles
 * - Customers download signed bundles for settlement
 *
 * Benefits over true mesh networking:
 * - No battery drain (only syncs when online)
 * - High reliability (HTTP is battle-tested)
 * - Easy testing (no need for 5+ physical devices)
 * - Low maintenance (standard REST API)
 * - Graceful fallback to QR if relay unavailable
 */

import { Config } from '../config';
import { attestationService, type AttestedBundle } from './AttestationService';
import { SettlementService } from './SettlementService';
import { encodeOfflineBundle, decodeOfflineBundle, type PersistedOfflineBundle } from '../storage/BundleStorage';
import { serializeBundle, type OfflineBundle, type AttestationEnvelope } from '@beam/shared';
import { wallet } from '../wallet/WalletManager';
import { Buffer } from 'buffer';

const UPLOAD_INTERVAL_MS = 30_000; // 30 seconds
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const RELAY_TIMEOUT_MS = 15_000; // 15 seconds

export interface BundleRelayConfig {
  endpoint: string;
  uploadInterval?: number;
  pollInterval?: number;
  timeout?: number;
}

export interface RelayBundle {
  bundleId: string;
  payerPubkey: string;
  merchantPubkey: string;
  bundleData: PersistedOfflineBundle;
  payerAttestation?: any;
  merchantAttestation?: any;
  uploadedAt?: number;
  encryptedPayload?: string;
}

export interface RelayDiagnostics {
  uploadEnabled: boolean;
  pollEnabled: boolean;
  lastUploadAt: number | null;
  lastUploadSuccess: number | null;
  lastPollAt: number | null;
  lastPollSuccess: number | null;
  pendingUploads: number;
  lastError: string | null;
}

/**
 * Bundle Relay Service
 *
 * Manages automatic upload and download of bundles via verifier relay.
 */
export class BundleRelayService {
  private readonly endpoint: string;
  private readonly uploadInterval: number;
  private readonly pollInterval: number;
  private readonly timeout: number;
  private readonly settlementService: SettlementService;

  private uploadTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private diagnostics: RelayDiagnostics = {
    uploadEnabled: false,
    pollEnabled: false,
    lastUploadAt: null,
    lastUploadSuccess: null,
    lastPollAt: null,
    lastPollSuccess: null,
    pendingUploads: 0,
    lastError: null,
  };

  private diagnosticsListeners = new Set<(diag: RelayDiagnostics) => void>();

  constructor(config?: Partial<BundleRelayConfig>) {
    this.endpoint = config?.endpoint || Config.services?.verifier || '';
    this.uploadInterval = config?.uploadInterval || UPLOAD_INTERVAL_MS;
    this.pollInterval = config?.pollInterval || POLL_INTERVAL_MS;
    this.timeout = config?.timeout || RELAY_TIMEOUT_MS;
    this.settlementService = new SettlementService();

    if (!this.endpoint) {
      if (__DEV__) {
        console.warn('[BundleRelay] Verifier endpoint not configured, relay disabled');
      }
    }
  }

  /**
   * Get current diagnostics snapshot
   */
  getDiagnostics(): RelayDiagnostics {
    return { ...this.diagnostics };
  }

  /**
   * Subscribe to diagnostics updates
   */
  addDiagnosticsListener(listener: (diag: RelayDiagnostics) => void): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.getDiagnostics());
    return () => {
      this.diagnosticsListeners.delete(listener);
    };
  }

  /**
   * Start automatic upload of pending bundles (customer role)
   *
   * Uploads bundles that:
   * - Are signed by payer but missing merchant signature
   * - Have not been uploaded yet (or upload failed)
   */
  async startAutoUpload(payerPubkey: string): Promise<void> {
    if (!this.endpoint) {
      if (__DEV__) {
        console.warn('[BundleRelay] Cannot start auto-upload: endpoint not configured');
      }
      return;
    }

    if (this.uploadTimer) {
      return; // Already running
    }

    this.updateDiagnostics({ uploadEnabled: true });

    this.uploadTimer = setInterval(async () => {
      try {
        const online = await this.settlementService.isOnline();
        if (online) {
          await this.uploadPendingBundles(payerPubkey);
        }
      } catch (err) {
        if (__DEV__) {
          console.error('[BundleRelay] Auto-upload error:', err);
        }
        this.updateDiagnostics({
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.uploadInterval);

    // Initial upload
    try {
      const online = await this.settlementService.isOnline();
      if (online) {
        await this.uploadPendingBundles(payerPubkey);
      }
    } catch (err) {
      // Ignore errors on initial upload
    }

    if (__DEV__) {
      console.log('[BundleRelay] Auto-upload started for payer:', payerPubkey.slice(0, 8));
    }
  }

  /**
   * Stop automatic upload
   */
  stopAutoUpload(): void {
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
      this.updateDiagnostics({ uploadEnabled: false });

      if (__DEV__) {
        console.log('[BundleRelay] Auto-upload stopped');
      }
    }
  }

  /**
   * Start automatic polling for bundles (merchant role)
   *
   * Polls for bundles that:
   * - Are addressed to this merchant
   * - Have payer signature but missing merchant signature
   */
  async startAutoPolling(merchantPubkey: string): Promise<void> {
    if (!this.endpoint) {
      if (__DEV__) {
        console.warn('[BundleRelay] Cannot start auto-polling: endpoint not configured');
      }
      return;
    }

    if (this.pollTimer) {
      return; // Already running
    }

    this.updateDiagnostics({ pollEnabled: true });

    this.pollTimer = setInterval(async () => {
      try {
        const online = await this.settlementService.isOnline();
        if (online) {
          await this.pollForBundles(merchantPubkey);
        }
      } catch (err) {
        if (__DEV__) {
          console.error('[BundleRelay] Auto-polling error:', err);
        }
        this.updateDiagnostics({
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.pollInterval);

    // Initial poll
    try {
      const online = await this.settlementService.isOnline();
      if (online) {
        await this.pollForBundles(merchantPubkey);
      }
    } catch (err) {
      // Ignore errors on initial poll
    }

    if (__DEV__) {
      console.log('[BundleRelay] Auto-polling started for merchant:', merchantPubkey.slice(0, 8));
    }
  }

  /**
   * Stop automatic polling
   */
  stopAutoPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.updateDiagnostics({ pollEnabled: false });

      if (__DEV__) {
        console.log('[BundleRelay] Auto-polling stopped');
      }
    }
  }

  /**
   * Upload all pending bundles that need merchant signature
   */
  async uploadPendingBundles(payerPubkey: string): Promise<number> {
    const now = Date.now();
    this.updateDiagnostics({ lastUploadAt: now });

    try {
      const attested = await attestationService.loadBundles();

      // Filter bundles that:
      // 1. Are created by this payer
      // 2. Are missing merchant signature (need to be relayed)
      const needRelay = attested.filter(
        a =>
          a.bundle.payer_pubkey === payerPubkey &&
          (!a.bundle.merchant_signature || a.bundle.merchant_signature.length === 0)
      );

      this.updateDiagnostics({ pendingUploads: needRelay.length });

      if (needRelay.length === 0) {
        this.updateDiagnostics({ lastUploadSuccess: now });
        return 0;
      }

      let uploadedCount = 0;

      for (const attested of needRelay) {
        try {
          await this.uploadBundle(attested);
          uploadedCount++;
        } catch (err) {
          if (__DEV__) {
            console.error(`[BundleRelay] Failed to upload ${attested.bundle.tx_id}:`, err);
          }
          // Continue with next bundle
        }
      }

      this.updateDiagnostics({
        lastUploadSuccess: now,
        pendingUploads: needRelay.length - uploadedCount,
        lastError: null,
      });

      if (__DEV__) {
        console.log(`[BundleRelay] Uploaded ${uploadedCount}/${needRelay.length} bundles`);
      }

      return uploadedCount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateDiagnostics({ lastError: message });
      throw err;
    }
  }

  /**
   * Upload a single bundle to relay
   */
  private async uploadBundle(attested: AttestedBundle): Promise<void> {
    const relayBundle: RelayBundle = {
      bundleId: attested.bundle.tx_id,
      payerPubkey: attested.bundle.payer_pubkey,
      merchantPubkey: attested.bundle.merchant_pubkey,
      bundleData: encodeOfflineBundle(attested.bundle),
      payerAttestation: attested.payerAttestation
        ? this.encodeAttestationForApi(attested.payerAttestation)
        : undefined,
    };

    const response = await this.withTimeout(
      fetch(`${this.endpoint}/relay/upload-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(relayBundle),
      }),
      this.timeout
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'unknown' }));
      throw new Error(error.error || `Upload failed: ${response.status}`);
    }

    if (__DEV__) {
      console.log('[BundleRelay] Uploaded bundle:', attested.bundle.tx_id.slice(0, 16));
    }
  }

  /**
   * Poll for bundles addressed to this merchant
   */
  async pollForBundles(merchantPubkey: string): Promise<number> {
    const now = Date.now();
    this.updateDiagnostics({ lastPollAt: now });

    try {
      const response = await this.withTimeout(
        fetch(`${this.endpoint}/relay/bundles/${merchantPubkey}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }),
        this.timeout
      );

      if (!response.ok) {
        if (response.status === 404) {
          // No bundles found, not an error
          this.updateDiagnostics({ lastPollSuccess: now, lastError: null });
          return 0;
        }
        throw new Error(`Poll failed: ${response.status}`);
      }

      const bundles: RelayBundle[] = await response.json();

      if (!Array.isArray(bundles) || bundles.length === 0) {
        this.updateDiagnostics({ lastPollSuccess: now, lastError: null });
        return 0;
      }

      let processedCount = 0;

      for (const relayBundle of bundles) {
        try {
          await this.processIncomingBundle(relayBundle, merchantPubkey);
          processedCount++;
        } catch (err) {
          if (__DEV__) {
            console.error(`[BundleRelay] Failed to process ${relayBundle.bundleId}:`, err);
          }
          // Continue with next bundle
        }
      }

      this.updateDiagnostics({
        lastPollSuccess: now,
        lastError: null,
      });

      if (__DEV__) {
        console.log(`[BundleRelay] Processed ${processedCount}/${bundles.length} bundles`);
      }

      return processedCount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateDiagnostics({ lastError: message });
      throw err;
    }
  }

  /**
   * Process an incoming bundle from relay
   */
  private async processIncomingBundle(relayBundle: RelayBundle, merchantPubkey: string): Promise<void> {
    const bundle = decodeOfflineBundle(relayBundle.bundleData);
    const payerAttestation = relayBundle.payerAttestation
      ? this.decodeAttestationFromApi(relayBundle.payerAttestation)
      : undefined;

    // Verify bundle is addressed to this merchant
    if (bundle.merchant_pubkey !== merchantPubkey) {
      throw new Error('Bundle not addressed to this merchant');
    }

    // Check if we already have this bundle
    const existing = await attestationService.loadBundles();
    if (existing.some(a => a.bundle.tx_id === bundle.tx_id)) {
      if (__DEV__) {
        console.log('[BundleRelay] Bundle already exists:', bundle.tx_id.slice(0, 16));
      }
      return;
    }

    // Sign bundle with merchant key
    const unsigned = {
      tx_id: bundle.tx_id,
      escrow_pda: bundle.escrow_pda,
      token: bundle.token,
      payer_pubkey: bundle.payer_pubkey,
      merchant_pubkey: bundle.merchant_pubkey,
      nonce: bundle.nonce,
      timestamp: bundle.timestamp,
      version: bundle.version,
    };

    const serialized = serializeBundle(unsigned);
    const merchantSignature = await attestationService.signPayload(
      serialized,
      'Sign payment receipt (via relay)'
    );

    const signedBundle: OfflineBundle = {
      ...bundle,
      merchant_signature: merchantSignature,
    };

    // Store bundle locally
    const metadata = {
      amount: signedBundle.token.amount,
      currency: signedBundle.token.symbol,
      merchantPubkey: signedBundle.merchant_pubkey,
      payerPubkey: signedBundle.payer_pubkey,
      nonce: signedBundle.nonce,
      createdAt: signedBundle.timestamp,
    };

    const merchantAttestation = await attestationService.storeBundle(signedBundle, metadata, {
      payerAttestation,
      selfRole: 'merchant',
    });

    // Upload signed bundle back for customer to download
    await this.uploadSignedBundle(signedBundle, payerAttestation, merchantAttestation);

    if (__DEV__) {
      console.log('[BundleRelay] Processed and signed bundle:', bundle.tx_id.slice(0, 16));
    }
  }

  /**
   * Upload a signed bundle (merchant → customer)
   */
  private async uploadSignedBundle(
    bundle: OfflineBundle,
    payerAttestation?: AttestationEnvelope,
    merchantAttestation?: AttestationEnvelope
  ): Promise<void> {
    const relayBundle: RelayBundle = {
      bundleId: bundle.tx_id,
      payerPubkey: bundle.payer_pubkey,
      merchantPubkey: bundle.merchant_pubkey,
      bundleData: encodeOfflineBundle(bundle),
      payerAttestation: payerAttestation ? this.encodeAttestationForApi(payerAttestation) : undefined,
      merchantAttestation: merchantAttestation ? this.encodeAttestationForApi(merchantAttestation) : undefined,
    };

    const response = await this.withTimeout(
      fetch(`${this.endpoint}/relay/upload-bundle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(relayBundle),
      }),
      this.timeout
    );

    if (!response.ok) {
      throw new Error(`Upload signed bundle failed: ${response.status}`);
    }
  }

  /**
   * Cleanup all timers
   */
  cleanup(): void {
    this.stopAutoUpload();
    this.stopAutoPolling();
    this.diagnosticsListeners.clear();
  }

  /**
   * Helper: Add timeout to fetch requests
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Helper: Encode attestation for API
   */
  private encodeAttestationForApi(envelope: AttestationEnvelope): any {
    return {
      bundleId: envelope.bundleId,
      timestamp: envelope.timestamp,
      nonce: Buffer.from(envelope.nonce).toString('base64'),
      attestationReport: Buffer.from(envelope.attestationReport).toString('base64'),
      signature: Buffer.from(envelope.signature).toString('base64'),
      certificateChain: envelope.certificateChain.map(cert => Buffer.from(cert).toString('base64')),
      deviceInfo: envelope.deviceInfo,
    };
  }

  /**
   * Helper: Decode attestation from API
   */
  private decodeAttestationFromApi(raw: any): AttestationEnvelope | undefined {
    if (!raw) return undefined;

    try {
      return {
        bundleId: raw.bundleId,
        timestamp: raw.timestamp,
        nonce: Buffer.from(raw.nonce, 'base64'),
        attestationReport: Buffer.from(raw.attestationReport, 'base64'),
        signature: Buffer.from(raw.signature, 'base64'),
        certificateChain: Array.isArray(raw.certificateChain)
          ? raw.certificateChain.map((cert: string) => Buffer.from(cert, 'base64'))
          : [],
        deviceInfo: raw.deviceInfo,
      };
    } catch (err) {
      if (__DEV__) {
        console.error('[BundleRelay] Failed to decode attestation:', err);
      }
      return undefined;
    }
  }

  /**
   * Helper: Update diagnostics and notify listeners
   */
  private updateDiagnostics(patch: Partial<RelayDiagnostics>): void {
    this.diagnostics = { ...this.diagnostics, ...patch };
    const snapshot = this.getDiagnostics();
    this.diagnosticsListeners.forEach(listener => listener(snapshot));
  }
}

// Singleton export
export const bundleRelayService = new BundleRelayService();
