/**
 * AutoSettlementService - Automatically settles offline bundles when online
 *
 * Features:
 * - Monitors network status
 * - Auto-fetches attestations when online
 * - Auto-settles bundles on Solana
 * - Works for both customer (sent) and merchant (received) bundles
 */

import { networkService } from './NetworkService';
import { bundleTransactionManager, BundleState } from '../storage/BundleTransactionManager';
import { SettlementService } from './SettlementService';
import { attestationService } from './AttestationService';
import { wallet } from '../wallet/WalletManager';
import type { OfflineBundle, AttestationEnvelope } from '@beam/shared';

type SettlementListener = (event: SettlementEvent) => void;

interface SettlementEvent {
  type: 'attestation_fetched' | 'settlement_started' | 'settlement_success' | 'settlement_error';
  bundleId: string;
  message?: string;
  error?: string;
}

class AutoSettlementService {
  private settlementService: SettlementService;
  private listeners = new Set<SettlementListener>();
  private isProcessing = false;
  private networkUnsubscribe: (() => void) | null = null;

  constructor() {
    this.settlementService = new SettlementService();
    this.startMonitoring();
  }

  /**
   * Start monitoring network status and auto-settle when online
   */
  private startMonitoring(): void {
    console.log('[AutoSettlement] Starting auto-settlement monitoring');

    this.networkUnsubscribe = networkService.addOnlineListener(async isOnline => {
      if (isOnline && !this.isProcessing) {
        console.log('[AutoSettlement] 🌐 Online detected - checking for pending bundles...');
        await this.processPendingBundles();
      }
    });
  }

  /**
   * Process all pending bundles (attestation + settlement)
   */
  private async processPendingBundles(): Promise<void> {
    if (this.isProcessing) {
      console.log('[AutoSettlement] Already processing - skipping');
      return;
    }

    this.isProcessing = true;

    try {
      const pubkey = await wallet.loadWallet();
      if (!pubkey) {
        console.warn('[AutoSettlement] No wallet loaded - skipping');
        return;
      }

      const pubkeyStr = pubkey.toBase58();
      console.log('[AutoSettlement] Loading pending bundles for:', pubkeyStr);

      // Get all bundles that need processing
      const allBundles = await bundleTransactionManager.getAllStoredBundles();
      console.log(`[AutoSettlement] Found ${allBundles.length} total stored bundles`);

      // Filter bundles that need attestation or settlement
      const needsAttestationOrSettlement = allBundles.filter(stored => {
        const state = stored.metadata.state || BundleState.PENDING;
        return (
          state === BundleState.PENDING ||
          state === BundleState.ATTESTED ||
          state === BundleState.QUEUED
        );
      });

      console.log(
        `[AutoSettlement] ${needsAttestationOrSettlement.length} bundles need attestation or settlement`
      );

      if (needsAttestationOrSettlement.length === 0) {
        console.log('[AutoSettlement] No pending bundles to process');
        return;
      }

      // Process each bundle
      for (const stored of needsAttestationOrSettlement) {
        try {
          await this.processSingleBundle(stored.bundle, stored.payerAttestation, stored.merchantAttestation);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[AutoSettlement] Failed to process bundle ${stored.bundle.tx_id}:`, message);
          this.notifyListeners({
            type: 'settlement_error',
            bundleId: stored.bundle.tx_id,
            error: message,
          });
        }

        // Small delay between bundles to avoid overwhelming the network
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('[AutoSettlement] ✅ Finished processing all pending bundles');
    } catch (err) {
      console.error('[AutoSettlement] Error in processPendingBundles:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single bundle: fetch attestations if needed, then settle
   */
  private async processSingleBundle(
    bundle: OfflineBundle,
    payerAttestation?: AttestationEnvelope,
    merchantAttestation?: AttestationEnvelope
  ): Promise<void> {
    console.log(`[AutoSettlement] Processing bundle: ${bundle.tx_id}`);

    const pubkey = await wallet.loadWallet();
    if (!pubkey) {
      throw new Error('Wallet not loaded');
    }

    const pubkeyStr = pubkey.toBase58();
    const isPayer = bundle.payer_pubkey === pubkeyStr;
    const isMerchant = bundle.merchant_pubkey === pubkeyStr;

    console.log(`[AutoSettlement] Role: ${isPayer ? 'PAYER' : isMerchant ? 'MERCHANT' : 'UNKNOWN'}`);

    // Step 1: Fetch attestations if missing
    let finalPayerAttestation = payerAttestation;
    let finalMerchantAttestation = merchantAttestation;

    if (!finalPayerAttestation) {
      console.log(`[AutoSettlement] Fetching payer attestation for ${bundle.tx_id}...`);
      try {
        finalPayerAttestation = await attestationService.getAttestation(
          bundle.tx_id,
          bundle.payer_pubkey,
          bundle.merchant_pubkey,
          bundle.token.amount,
          bundle.nonce,
          'payer'
        );
        console.log('[AutoSettlement] ✅ Payer attestation fetched');

        // Update stored bundle with attestation
        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.ATTESTED, {
          payerAttestation: finalPayerAttestation,
        });

        this.notifyListeners({
          type: 'attestation_fetched',
          bundleId: bundle.tx_id,
          message: 'Payer attestation fetched',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[AutoSettlement] Failed to fetch payer attestation:', message);
        throw new Error(`Payer attestation failed: ${message}`);
      }
    }

    // Merchant attestation is optional - try to fetch but don't fail if it errors
    if (!finalMerchantAttestation) {
      console.log(`[AutoSettlement] Attempting to fetch merchant attestation for ${bundle.tx_id}...`);
      try {
        finalMerchantAttestation = await attestationService.getAttestation(
          bundle.tx_id,
          bundle.payer_pubkey,
          bundle.merchant_pubkey,
          bundle.token.amount,
          bundle.nonce,
          'merchant'
        );
        console.log('[AutoSettlement] ✅ Merchant attestation fetched');

        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.ATTESTED, {
          merchantAttestation: finalMerchantAttestation,
        });

        this.notifyListeners({
          type: 'attestation_fetched',
          bundleId: bundle.tx_id,
          message: 'Merchant attestation fetched',
        });
      } catch (err) {
        console.warn('[AutoSettlement] Merchant attestation unavailable (optional):', err);
        // Continue without merchant attestation
      }
    }

    // Step 2: Settle on-chain
    if (!finalPayerAttestation) {
      throw new Error('Cannot settle without payer attestation');
    }

    console.log(`[AutoSettlement] 🚀 Settling bundle ${bundle.tx_id} on Solana...`);

    this.notifyListeners({
      type: 'settlement_started',
      bundleId: bundle.tx_id,
      message: 'Submitting to Solana',
    });

    try {
      // Get wallet signer
      const signer = await wallet.getSigner();
      if (!signer) {
        throw new Error('Wallet signer not available');
      }

      // Get stored bundle metadata
      const stored = await bundleTransactionManager.getBundle(bundle.tx_id);
      if (!stored) {
        throw new Error('Bundle not found in storage');
      }

      // Create attested bundle input for settlement
      const attestedBundle = {
        bundle,
        payerAttestation: finalPayerAttestation,
        merchantAttestation: finalMerchantAttestation,
        metadata: stored.metadata || {
          amount: bundle.token.amount,
          currency: bundle.token.symbol,
          merchantPubkey: bundle.merchant_pubkey,
          payerPubkey: bundle.payer_pubkey,
          nonce: bundle.nonce,
          createdAt: bundle.timestamp,
        },
      };

      // Use settleBundleOnchain instead of the non-existent settleOfflinePayment
      const result = await this.settlementService.settleBundleOnchain(attestedBundle, signer);

      console.log(`[AutoSettlement] ✅ Settlement successful! Signature: ${result.signature}`);

      await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.SETTLED, {
        signature: result.signature,
        settledAt: Date.now(),
      });

      this.notifyListeners({
        type: 'settlement_success',
        bundleId: bundle.tx_id,
        message: `Settled: ${result.signature}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[AutoSettlement] ❌ Settlement failed:', message);

      await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.FAILED, {
        error: message,
      });

      throw new Error(`Settlement failed: ${message}`);
    }
  }

  /**
   * Manually trigger settlement processing (useful for testing or manual retry)
   */
  async triggerSettlement(): Promise<void> {
    console.log('[AutoSettlement] Manual settlement trigger');
    await this.processPendingBundles();
  }

  /**
   * Add a listener for settlement events
   */
  addSettlementListener(listener: SettlementListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: SettlementEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (err) {
        console.error('[AutoSettlement] Listener error:', err);
      }
    });
  }

  /**
   * Stop monitoring (cleanup)
   */
  destroy(): void {
    this.networkUnsubscribe?.();
    this.listeners.clear();
  }
}

// Singleton instance
export const autoSettlementService = new AutoSettlementService();
