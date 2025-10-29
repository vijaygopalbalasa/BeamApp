/**
 * Phase 1.4: Hybrid Attestation Queue
 *
 * Manages async attestation fetching for offline payments:
 * - Payments work offline with software signatures
 * - Attestations fetched later when online
 * - Graceful degradation if attestation fails
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { attestationIntegration } from './AttestationIntegrationService';

const QUEUE_KEY = 'attestation_queue';
const MAX_RETRY_COUNT = 5;
const RETRY_DELAY_MS = 60000; // 1 minute

export interface PendingAttestation {
  bundleId: string;
  queuedAt: number;
  retryCount: number;
  lastAttempt?: number;
}

export enum AttestationStatus {
  None = 'none',           // Software-only signature
  Pending = 'pending',     // Queued for attestation
  Verified = 'verified',   // Hardware attestation confirmed
  Failed = 'failed',       // Attestation check failed
  TimedOut = 'timedout',   // 24h passed, proceeding anyway
}

class AttestationQueueService {
  private processing = false;
  private unsubscribe: (() => void) | null = null;

  /**
   * Queue a bundle for attestation when online
   */
  async queueBundle(bundleId: string): Promise<void> {
    try {
      const queue = await this.getQueue();

      // Check if already queued
      if (queue.some(item => item.bundleId === bundleId)) {
        console.log('[AttestationQueue] Bundle already queued:', bundleId);
        return;
      }

      const item: PendingAttestation = {
        bundleId,
        queuedAt: Date.now(),
        retryCount: 0,
      };

      queue.push(item);
      await this.saveQueue(queue);

      console.log('[AttestationQueue] Queued bundle for attestation:', bundleId);

      // Try processing immediately if online
      this.processQueue().catch(err => {
        console.warn('[AttestationQueue] Failed to process queue:', err);
      });
    } catch (err) {
      console.error('[AttestationQueue] Failed to queue bundle:', err);
    }
  }

  /**
   * Start background processing
   */
  startProcessing(): void {
    if (this.unsubscribe) {
      return; // Already started
    }

    // Process on network state changes
    this.unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        console.log('[AttestationQueue] Network connected, processing queue');
        this.processQueue().catch(err => {
          console.warn('[AttestationQueue] Queue processing failed:', err);
        });
      }
    });

    // Initial process attempt
    this.processQueue().catch(err => {
      console.warn('[AttestationQueue] Initial queue processing failed:', err);
    });
  }

  /**
   * Stop background processing
   */
  stopProcessing(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Process queued attestations
   */
  async processQueue(): Promise<void> {
    if (this.processing) {
      return; // Already processing
    }

    try {
      this.processing = true;

      const netInfo = await NetInfo.fetch();
      if (!netInfo.isConnected) {
        console.log('[AttestationQueue] Offline, skipping queue processing');
        return;
      }

      const queue = await this.getQueue();
      if (queue.length === 0) {
        return;
      }

      console.log('[AttestationQueue] Processing queue:', queue.length, 'items');

      const now = Date.now();
      const updatedQueue: PendingAttestation[] = [];

      for (const item of queue) {
        // Check if timed out (24 hours)
        const age = now - item.queuedAt;
        if (age > 24 * 60 * 60 * 1000) {
          console.log('[AttestationQueue] Bundle timed out:', item.bundleId);
          await this.updateBundleStatus(item.bundleId, AttestationStatus.TimedOut);
          continue; // Remove from queue
        }

        // Check if should retry
        if (item.lastAttempt) {
          const timeSinceAttempt = now - item.lastAttempt;
          if (timeSinceAttempt < RETRY_DELAY_MS) {
            updatedQueue.push(item); // Keep in queue, retry later
            continue;
          }
        }

        // Check retry limit
        if (item.retryCount >= MAX_RETRY_COUNT) {
          console.log('[AttestationQueue] Max retries reached:', item.bundleId);
          await this.updateBundleStatus(item.bundleId, AttestationStatus.Failed);
          continue; // Remove from queue
        }

        // Attempt attestation
        try {
          console.log('[AttestationQueue] Fetching attestation for:', item.bundleId);

          // This will call Play Integrity API
          const attestation = await attestationIntegration.createAttestation({
            tx_id: item.bundleId,
            // ... other bundle fields will be loaded from storage
          } as any);

          // Attach attestation to bundle in storage
          await this.attachAttestation(item.bundleId, attestation);
          await this.updateBundleStatus(item.bundleId, AttestationStatus.Verified);

          console.log('[AttestationQueue] ✅ Attestation fetched successfully:', item.bundleId);
          // Success - remove from queue by not adding to updatedQueue
        } catch (err) {
          console.error('[AttestationQueue] Attestation failed:', item.bundleId, err);

          // Update retry count and keep in queue
          updatedQueue.push({
            ...item,
            retryCount: item.retryCount + 1,
            lastAttempt: now,
          });
        }
      }

      await this.saveQueue(updatedQueue);

      if (updatedQueue.length > 0) {
        console.log('[AttestationQueue] Remaining items:', updatedQueue.length);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get bundle attestation status
   */
  async getStatus(bundleId: string): Promise<AttestationStatus> {
    try {
      const statusStr = await AsyncStorage.getItem(`attestation_status:${bundleId}`);
      return (statusStr as AttestationStatus) || AttestationStatus.None;
    } catch {
      return AttestationStatus.None;
    }
  }

  /**
   * Clear queue (for testing)
   */
  async clearQueue(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  }

  // Private methods

  private async getQueue(): Promise<PendingAttestation[]> {
    try {
      const json = await AsyncStorage.getItem(QUEUE_KEY);
      return json ? JSON.parse(json) : [];
    } catch (err) {
      console.error('[AttestationQueue] Failed to load queue:', err);
      return [];
    }
  }

  private async saveQueue(queue: PendingAttestation[]): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.error('[AttestationQueue] Failed to save queue:', err);
    }
  }

  private async updateBundleStatus(bundleId: string, status: AttestationStatus): Promise<void> {
    try {
      await AsyncStorage.setItem(`attestation_status:${bundleId}`, status);
      console.log('[AttestationQueue] Updated status:', bundleId, '→', status);
    } catch (err) {
      console.error('[AttestationQueue] Failed to update status:', err);
    }
  }

  private async attachAttestation(bundleId: string, attestation: any): Promise<void> {
    try {
      // Store attestation data
      await AsyncStorage.setItem(
        `attestation_data:${bundleId}`,
        JSON.stringify(attestation)
      );
      console.log('[AttestationQueue] Attached attestation to bundle:', bundleId);
    } catch (err) {
      console.error('[AttestationQueue] Failed to attach attestation:', err);
      throw err;
    }
  }
}

export const attestationQueue = new AttestationQueueService();
