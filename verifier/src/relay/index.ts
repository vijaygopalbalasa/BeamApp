/**
 * Bundle Relay Service
 *
 * Provides store-and-forward relay functionality for offline payment bundles.
 * Acts as a message broker between customers and merchants when both parties
 * are not simultaneously online.
 *
 * Flow:
 * 1. Customer uploads unsigned bundle to /relay/upload-bundle
 * 2. Merchant polls /relay/bundles/:pubkey and downloads bundle
 * 3. Merchant signs bundle and re-uploads to /relay/upload-bundle
 * 4. Customer polls /relay/bundles/:pubkey and downloads signed bundle
 * 5. Either party settles on-chain when ready
 *
 * Storage:
 * - In-memory Map for MVP (can be replaced with Redis/PostgreSQL)
 * - Auto-expires bundles after 7 days
 * - Indexes by merchant_pubkey for fast retrieval
 */

import type { Request, Response } from 'express';

const BUNDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BUNDLE_SIZE = 256 * 1024; // 256KB
const MAX_BUNDLES_PER_KEY = 100; // Prevent spam

export interface RelayBundle {
  bundleId: string;
  payerPubkey: string;
  merchantPubkey: string;
  bundleData: any;
  payerAttestation?: any;
  merchantAttestation?: any;
  uploadedAt: number;
  expiresAt: number;
  downloaded: boolean;
}

// In-memory storage (replace with Redis/PostgreSQL for production)
const relayStore = new Map<string, RelayBundle[]>();

// Cleanup expired bundles every hour
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;

  for (const [pubkey, bundles] of relayStore.entries()) {
    const filtered = bundles.filter(b => {
      if (b.expiresAt < now) {
        expiredCount++;
        return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      relayStore.delete(pubkey);
    } else if (filtered.length !== bundles.length) {
      relayStore.set(pubkey, filtered);
    }
  }

  if (expiredCount > 0) {
    console.log(`[relay] Cleaned up ${expiredCount} expired bundles`);
  }
}, 60 * 60 * 1000); // Every hour

/**
 * Upload a bundle to relay queue
 *
 * POST /relay/upload-bundle
 * Body: {
 *   bundleId: string,
 *   payerPubkey: string,
 *   merchantPubkey: string,
 *   bundleData: PersistedOfflineBundle,
 *   payerAttestation?: AttestationEnvelope,
 *   merchantAttestation?: AttestationEnvelope
 * }
 */
export async function uploadBundle(req: Request, res: Response): Promise<void> {
  try {
    const {
      bundleId,
      payerPubkey,
      merchantPubkey,
      bundleData,
      payerAttestation,
      merchantAttestation,
    } = req.body;

    // Validation
    if (!bundleId || typeof bundleId !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'bundleId required' });
      return;
    }

    if (!payerPubkey || typeof payerPubkey !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'payerPubkey required' });
      return;
    }

    if (!merchantPubkey || typeof merchantPubkey !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'merchantPubkey required' });
      return;
    }

    if (!bundleData || typeof bundleData !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'bundleData required' });
      return;
    }

    // Size check
    const bundleSize = JSON.stringify(req.body).length;
    if (bundleSize > MAX_BUNDLE_SIZE) {
      res.status(413).json({
        error: 'payload_too_large',
        message: `Bundle exceeds ${MAX_BUNDLE_SIZE} bytes`,
      });
      return;
    }

    // Get or create bundle list for merchant
    let merchantBundles = relayStore.get(merchantPubkey);
    if (!merchantBundles) {
      merchantBundles = [];
      relayStore.set(merchantPubkey, merchantBundles);
    }

    // Check if bundle already exists (idempotent upload)
    const existingIndex = merchantBundles.findIndex(b => b.bundleId === bundleId);

    const now = Date.now();
    const relayBundle: RelayBundle = {
      bundleId,
      payerPubkey,
      merchantPubkey,
      bundleData,
      payerAttestation,
      merchantAttestation,
      uploadedAt: now,
      expiresAt: now + BUNDLE_TTL_MS,
      downloaded: false,
    };

    if (existingIndex >= 0) {
      // Update existing bundle
      merchantBundles[existingIndex] = relayBundle;
      console.log(`[relay] Updated bundle ${bundleId.slice(0, 16)} for merchant ${merchantPubkey.slice(0, 8)}`);
    } else {
      // Check spam limit
      if (merchantBundles.length >= MAX_BUNDLES_PER_KEY) {
        res.status(429).json({
          error: 'quota_exceeded',
          message: `Maximum ${MAX_BUNDLES_PER_KEY} bundles per merchant`,
        });
        return;
      }

      // Add new bundle
      merchantBundles.push(relayBundle);
      console.log(`[relay] Uploaded bundle ${bundleId.slice(0, 16)} for merchant ${merchantPubkey.slice(0, 8)}`);
    }

    // Also store for payer (for signed bundle retrieval)
    let payerBundles = relayStore.get(payerPubkey);
    if (!payerBundles) {
      payerBundles = [];
      relayStore.set(payerPubkey, payerBundles);
    }

    const payerExistingIndex = payerBundles.findIndex(b => b.bundleId === bundleId);
    if (payerExistingIndex >= 0) {
      payerBundles[payerExistingIndex] = relayBundle;
    } else {
      if (payerBundles.length < MAX_BUNDLES_PER_KEY) {
        payerBundles.push(relayBundle);
      }
    }

    res.json({
      success: true,
      bundleId,
      expiresAt: relayBundle.expiresAt,
    });
  } catch (err) {
    console.error('[relay] Upload error:', err);
    res.status(500).json({
      error: 'server_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Retrieve bundles for a specific pubkey
 *
 * GET /relay/bundles/:pubkey
 */
export async function getBundlesForPubkey(req: Request, res: Response): Promise<void> {
  try {
    const { pubkey } = req.params;

    if (!pubkey || typeof pubkey !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'pubkey required' });
      return;
    }

    const bundles = relayStore.get(pubkey);

    if (!bundles || bundles.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'No bundles found' });
      return;
    }

    // Filter out expired bundles
    const now = Date.now();
    const validBundles = bundles.filter(b => b.expiresAt >= now);

    if (validBundles.length === 0) {
      relayStore.delete(pubkey);
      res.status(404).json({ error: 'not_found', message: 'No bundles found' });
      return;
    }

    // Mark bundles as downloaded (for optional cleanup)
    validBundles.forEach(b => {
      b.downloaded = true;
    });

    console.log(`[relay] Retrieved ${validBundles.length} bundles for ${pubkey.slice(0, 8)}`);

    res.json(
      validBundles.map(b => ({
        bundleId: b.bundleId,
        payerPubkey: b.payerPubkey,
        merchantPubkey: b.merchantPubkey,
        bundleData: b.bundleData,
        payerAttestation: b.payerAttestation,
        merchantAttestation: b.merchantAttestation,
        uploadedAt: b.uploadedAt,
      }))
    );

    // Optional: Delete downloaded bundles after 24 hours
    // This is handled by the cleanup interval
  } catch (err) {
    console.error('[relay] Retrieval error:', err);
    res.status(500).json({
      error: 'server_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Get relay statistics (admin endpoint)
 *
 * GET /relay/stats
 */
export async function getRelayStats(req: Request, res: Response): Promise<void> {
  try {
    let totalBundles = 0;
    let totalKeys = 0;
    let downloadedBundles = 0;
    let expiredBundles = 0;

    const now = Date.now();

    for (const [pubkey, bundles] of relayStore.entries()) {
      totalKeys++;
      for (const bundle of bundles) {
        totalBundles++;
        if (bundle.downloaded) {
          downloadedBundles++;
        }
        if (bundle.expiresAt < now) {
          expiredBundles++;
        }
      }
    }

    res.json({
      totalKeys,
      totalBundles,
      downloadedBundles,
      expiredBundles,
      activeBundles: totalBundles - expiredBundles,
      storageType: 'in-memory',
    });
  } catch (err) {
    console.error('[relay] Stats error:', err);
    res.status(500).json({
      error: 'server_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Clear all bundles (admin endpoint - dev only)
 *
 * POST /relay/clear
 */
export async function clearAllBundles(req: Request, res: Response): Promise<void> {
  try {
    const bundleCount = Array.from(relayStore.values()).reduce((sum, bundles) => sum + bundles.length, 0);

    relayStore.clear();

    console.log(`[relay] Cleared ${bundleCount} bundles from relay store`);

    res.json({
      success: true,
      cleared: bundleCount,
    });
  } catch (err) {
    console.error('[relay] Clear error:', err);
    res.status(500).json({
      error: 'server_error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
