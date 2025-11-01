import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import type { OfflineBundle, AttestationEnvelope, AttestationType } from '@beam/shared';
import { bundleStorage, encodeOfflineBundle, decodeOfflineBundle } from './BundleStorage';
import { attestationService } from '../services/AttestationService';
import { attestationQueue } from '../services/AttestationQueue';
import type { BundleMetadata } from '../native/SecureStorageBridge';

const TRANSACTION_LOG_KEY = '@beam:transaction_log';
const TRANSACTION_STATE_KEY = '@beam:transaction_state';
const TRANSACTION_INDEX_KEY = '@beam:transaction_index';

export enum BundleState {
  PENDING = 'PENDING',
  ATTESTED = 'ATTESTED',
  QUEUED = 'QUEUED',
  BROADCAST = 'BROADCAST',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  ROLLBACK = 'ROLLBACK',
}

export interface BundleTransaction {
  id: string; // transaction ID (same as bundle.tx_id)
  state: BundleState;
  timestamp: number;
  bundle?: OfflineBundle;
  metadata?: BundleMetadata;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
  error?: string;
  retryCount: number;
  lastRetryAt?: number;
}

export interface TransactionLogEntry {
  transactionId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'ROLLBACK';
  timestamp: number;
  state: BundleState;
  storages: {
    bundleStorage: boolean;
    secureStorage: boolean;
    merchantStorage?: boolean;
  };
  error?: string;
}

export interface BundleCreationOptions {
  bundle: OfflineBundle;
  metadata: BundleMetadata;
  selfRole: 'payer' | 'merchant';
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
  skipAttestation?: boolean;
}

export interface BundleReceiptOptions {
  bundle: OfflineBundle;
  metadata: BundleMetadata;
  payerAttestation?: AttestationEnvelope;
}

type SerializableAttestationEnvelope = {
  bundleId: string;
  timestamp: number;
  nonce: number[];
  signature: number[];
  attestationReport: number[];
  certificateChain: number[][];
  deviceInfo: AttestationEnvelope['deviceInfo'];
  attestationType?: AttestationType;
};

type SerializableBundleTransaction = Omit<BundleTransaction, 'bundle' | 'payerAttestation' | 'merchantAttestation'> & {
  bundle?: ReturnType<typeof encodeOfflineBundle>;
  payerAttestation?: SerializableAttestationEnvelope;
  merchantAttestation?: SerializableAttestationEnvelope;
};

function toByteArray(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
    return Uint8Array.from(value as number[]);
  }
  if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
    return toByteArray((value as Record<string, unknown>).data);
  }
  return undefined;
}

function encodeAttestationForStorage(envelope?: AttestationEnvelope): SerializableAttestationEnvelope | undefined {
  if (!envelope) {
    return undefined;
  }

  return {
    bundleId: envelope.bundleId,
    timestamp: envelope.timestamp,
    nonce: Array.from(envelope.nonce),
    signature: Array.from(envelope.signature),
    attestationReport: Array.from(envelope.attestationReport),
    certificateChain: envelope.certificateChain.map(cert => Array.from(cert)),
    deviceInfo: envelope.deviceInfo,
    attestationType: envelope.attestationType,
  };
}

function decodeAttestationFromStorage(value: unknown): AttestationEnvelope | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const data = value as Record<string, unknown>;

  try {
    const bundleId = typeof data.bundleId === 'string' ? data.bundleId : '';
    const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Number(data.timestamp ?? 0);
    const nonce = toByteArray(data.nonce);
    const signature = toByteArray(data.signature);
    const report = toByteArray(data.attestationReport);
    const certChainRaw = Array.isArray(data.certificateChain) ? data.certificateChain : [];
    const certificateChain: Uint8Array[] = [];

    for (const cert of certChainRaw) {
      const certBytes = toByteArray(cert);
      if (certBytes) {
        certificateChain.push(certBytes);
      } else {
        throw new Error('Invalid certificate entry');
      }
    }

    const deviceInfo = data.deviceInfo as AttestationEnvelope['deviceInfo'] | undefined;
    if (!nonce || !signature || !report || certificateChain.length !== certChainRaw.length || !deviceInfo) {
      throw new Error('Missing attestation fields');
    }

    return {
      bundleId,
      timestamp,
      nonce,
      signature,
      attestationReport: report,
      certificateChain,
      deviceInfo,
      attestationType: data.attestationType as AttestationType | undefined,
    };
  } catch (err) {
    if (__DEV__) {
      console.warn('[BundleTransactionManager] Failed to decode attestation envelope from storage:', err);
    }
    return undefined;
  }
}

function serializeTransaction(transaction: BundleTransaction): SerializableBundleTransaction {
  return {
    ...transaction,
    bundle: transaction.bundle ? encodeOfflineBundle(transaction.bundle) : undefined,
    payerAttestation: encodeAttestationForStorage(transaction.payerAttestation),
    merchantAttestation: encodeAttestationForStorage(transaction.merchantAttestation),
  };
}

function deserializeTransaction(serialized: SerializableBundleTransaction): BundleTransaction {
  return {
    ...serialized,
    retryCount: typeof serialized.retryCount === 'number' ? serialized.retryCount : Number(serialized.retryCount ?? 0),
    lastRetryAt: typeof serialized.lastRetryAt === 'number' ? serialized.lastRetryAt : undefined,
    bundle: serialized.bundle ? decodeOfflineBundle(serialized.bundle) : undefined,
    payerAttestation: serialized.payerAttestation ? decodeAttestationFromStorage(serialized.payerAttestation) : undefined,
    merchantAttestation: serialized.merchantAttestation
      ? decodeAttestationFromStorage(serialized.merchantAttestation)
      : undefined,
  };
}

class BundleTransactionManager {
  private transactionLock = new Map<string, Promise<void>>();
  private recovering = false;

  constructor() {
    // Auto-recovery on startup
    this.recoverTransactions().catch(err => {
      if (__DEV__) {
        console.error('Failed to recover transactions on startup:', err);
      }
    });
  }

  /**
   * Get transaction index from AsyncStorage
   */
  private async getTransactionIndex(): Promise<Set<string>> {
    try {
      const json = await AsyncStorage.getItem(TRANSACTION_INDEX_KEY);
      if (json) {
        const array: string[] = JSON.parse(json);
        return new Set(array);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to load transaction index:', error);
      }
    }
    return new Set();
  }

  /**
   * Save transaction index to AsyncStorage
   */
  private async saveTransactionIndex(index: Set<string>): Promise<void> {
    try {
      const array = Array.from(index);
      await AsyncStorage.setItem(TRANSACTION_INDEX_KEY, JSON.stringify(array));
    } catch (error) {
      if (__DEV__) {
        console.error('Failed to save transaction index:', error);
      }
    }
  }

  /**
   * Add transaction ID to index
   */
  private async addToIndex(txId: string): Promise<void> {
    const index = await this.getTransactionIndex();
    index.add(txId);
    await this.saveTransactionIndex(index);
  }

  /**
   * Remove transaction ID from index
   */
  private async removeFromIndex(txId: string): Promise<void> {
    const index = await this.getTransactionIndex();
    index.delete(txId);
    await this.saveTransactionIndex(index);
  }

  /**
   * Create a bundle with atomic multi-storage transaction
   * Ensures all storages are written or all are rolled back
   */
  async createBundle(options: BundleCreationOptions): Promise<BundleTransaction> {
    const { bundle, metadata, selfRole, payerAttestation, merchantAttestation, skipAttestation } = options;
    const txId = bundle.tx_id;

    // Prevent concurrent transactions on the same bundle
    await this.waitForLock(txId);
    const lockPromise = this.executeLocked(txId, async () => {
      const transaction: BundleTransaction = {
        id: txId,
        state: BundleState.PENDING,
        timestamp: Date.now(),
        bundle,
        metadata,
        payerAttestation,
        merchantAttestation,
        retryCount: 0,
      };

      try {
        // Step 1: Write transaction log (write-ahead logging)
        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'CREATE',
          timestamp: Date.now(),
          state: BundleState.PENDING,
          storages: {
            bundleStorage: false,
            secureStorage: false,
          },
        });

        // Step 2: Save to BundleStorage (AsyncStorage)
        await bundleStorage.addBundle(bundle);
        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'UPDATE',
          timestamp: Date.now(),
          state: BundleState.PENDING,
          storages: {
            bundleStorage: true,
            secureStorage: false,
          },
        });

        // Step 3: Save to SecureStorage with attestation
        let fetchedAttestation: AttestationEnvelope | undefined;
        if (!skipAttestation) {
          try {
            fetchedAttestation = await attestationService.storeBundle(bundle, metadata, {
              selfRole,
              payerAttestation,
              merchantAttestation,
              usePlayIntegrity: true,
            });

            // Update transaction with attestation
            if (selfRole === 'payer') {
              transaction.payerAttestation = fetchedAttestation || payerAttestation;
            } else {
              transaction.merchantAttestation = fetchedAttestation || merchantAttestation;
            }
          } catch (attestationError) {
            // Graceful degradation - log but don't rollback (allow offline payments)
            const errorMessage = attestationError instanceof Error ? attestationError.message : String(attestationError);

            if (__DEV__) {
              console.warn('[BundleTransactionManager] Attestation failed, queuing for later:', errorMessage);
            }

            // Queue for background retry when online
            try {
              await attestationQueue.queueBundle(bundle.tx_id);
              console.log('[BundleTransactionManager] Attestation queued for retry');
            } catch (queueError) {
              console.error('[BundleTransactionManager] Failed to queue attestation:', queueError);
            }

            // Continue without attestation - will be fetched later
          }
        } else {
          // Store without fetching new attestation
          await attestationService.storeBundle(bundle, metadata, {
            selfRole,
            payerAttestation,
            merchantAttestation,
          });
        }

        transaction.state = BundleState.ATTESTED;

        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'UPDATE',
          timestamp: Date.now(),
          state: BundleState.ATTESTED,
          storages: {
            bundleStorage: true,
            secureStorage: true,
          },
        });

        // Step 4: Save transaction state
        await this.saveTransactionState(transaction);

        return transaction;
      } catch (error) {
        // Rollback on any error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (__DEV__) {
          console.error(`Bundle creation failed, initiating rollback for ${txId}:`, errorMessage);
        }

        await this.rollback(txId, errorMessage);

        throw new Error(`Bundle creation failed: ${errorMessage}`);
      }
    });

    return lockPromise;
  }

  /**
   * Store a received bundle (merchant receiving from customer)
   */
  async storeReceivedBundle(options: BundleReceiptOptions): Promise<BundleTransaction> {
    const { bundle, metadata, payerAttestation } = options;
    const txId = bundle.tx_id;

    if (__DEV__) {
      console.log(`[BundleTransactionManager] storeReceivedBundle called for ${txId}`);
    }

    await this.waitForLock(txId);
    if (__DEV__) {
      console.log(`[BundleTransactionManager] Lock acquired for ${txId}`);
    }

    const lockPromise = this.executeLocked(txId, async () => {
      const transaction: BundleTransaction = {
        id: txId,
        state: BundleState.PENDING,
        timestamp: Date.now(),
        bundle,
        metadata,
        payerAttestation,
        retryCount: 0,
      };

      try {
        if (__DEV__) {
          console.log(`[BundleTransactionManager] Writing CREATE log for ${txId}`);
        }

        // Write-ahead log
        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'CREATE',
          timestamp: Date.now(),
          state: BundleState.PENDING,
          storages: {
            bundleStorage: false,
            secureStorage: false,
            merchantStorage: false,
          },
        });

        if (__DEV__) {
          console.log(`[BundleTransactionManager] Saving to merchant EncryptedStorage for ${txId}`);
        }

        // Save to merchant's EncryptedStorage
        const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
        const json = await EncryptedStorage.getItem(MERCHANT_RECEIVED_KEY);
        const payments: OfflineBundle[] = json ? JSON.parse(json) : [];

        // Check for duplicates
        if (payments.some(p => p.tx_id === txId)) {
          throw new Error('Bundle already received');
        }

        payments.unshift(bundle);
        await EncryptedStorage.setItem(MERCHANT_RECEIVED_KEY, JSON.stringify(payments));

        if (__DEV__) {
          console.log(`[BundleTransactionManager] Writing UPDATE log for ${txId}`);
        }

        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'UPDATE',
          timestamp: Date.now(),
          state: BundleState.PENDING,
          storages: {
            bundleStorage: false,
            secureStorage: false,
            merchantStorage: true,
          },
        });

        if (__DEV__) {
          console.log(`[BundleTransactionManager] Calling attestationService.storeBundle for ${txId}`);
        }

        // Save to SecureStorage with merchant attestation
        // Skip attestation fetch in offline mode - will be fetched when online
        let merchantAttestation: AttestationEnvelope | undefined;
        try {
          merchantAttestation = await attestationService.storeBundle(bundle, metadata, {
            selfRole: 'merchant',
            payerAttestation,
            skipAttestationFetch: true, // Skip in offline mode - merchant can settle later
          });
          transaction.merchantAttestation = merchantAttestation;

          if (__DEV__) {
            console.log(`[BundleTransactionManager] attestationService.storeBundle completed for ${txId}`);
          }
        } catch (attestationError) {
          if (__DEV__) {
            console.error('Merchant attestation failed, rolling back:', attestationError);
          }
          throw new Error(
            `Merchant attestation failed: ${attestationError instanceof Error ? attestationError.message : String(attestationError)}`
          );
        }

        transaction.state = BundleState.ATTESTED;

        await this.writeTransactionLog({
          transactionId: txId,
          operation: 'UPDATE',
          timestamp: Date.now(),
          state: BundleState.ATTESTED,
          storages: {
            bundleStorage: false,
            secureStorage: true,
            merchantStorage: true,
          },
        });

        await this.saveTransactionState(transaction);

        return transaction;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (__DEV__) {
          console.error(`Receipt storage failed, initiating rollback for ${txId}:`, errorMessage);
        }

        await this.rollbackMerchantReceipt(txId, errorMessage);
        throw new Error(`Receipt storage failed: ${errorMessage}`);
      }
    });

    return lockPromise;
  }

  /**
   * Update bundle state atomically
   */
  async updateBundleState(
    txId: string,
    newState: BundleState,
    updates?: {
      payerAttestation?: AttestationEnvelope;
      merchantAttestation?: AttestationEnvelope;
      error?: string;
    }
  ): Promise<BundleTransaction | null> {
    await this.waitForLock(txId);
    return this.executeLocked(txId, async () => {
      const transaction = await this.getTransactionState(txId);
      if (!transaction) {
        return null;
      }

      transaction.state = newState;
      transaction.timestamp = Date.now();

      if (updates?.payerAttestation) {
        transaction.payerAttestation = updates.payerAttestation;
      }
      if (updates?.merchantAttestation) {
        transaction.merchantAttestation = updates.merchantAttestation;
      }
      if (updates?.error) {
        transaction.error = updates.error;
      }

      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'UPDATE',
        timestamp: Date.now(),
        state: newState,
        storages: {
          bundleStorage: true,
          secureStorage: true,
        },
        error: updates?.error,
      });

      await this.saveTransactionState(transaction);
      return transaction;
    });
  }

  /**
   * Delete bundle from all storages atomically
   */
  async deleteBundle(txId: string): Promise<void> {
    await this.waitForLock(txId);
    return this.executeLocked(txId, async () => {
      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'DELETE',
        timestamp: Date.now(),
        state: BundleState.SETTLED,
        storages: {
          bundleStorage: false,
          secureStorage: false,
        },
      });

      // Remove from all storages
      await Promise.all([
        bundleStorage.removeBundle(txId).catch(() => { }),
        attestationService.removeBundle(txId).catch(() => { }),
      ]);

      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'DELETE',
        timestamp: Date.now(),
        state: BundleState.SETTLED,
        storages: {
          bundleStorage: true,
          secureStorage: true,
        },
      });

      // Clean up transaction state
      await this.deleteTransactionState(txId);
    });
  }

  /**
   * Delete merchant receipt atomically
   */
  async deleteMerchantReceipt(txId: string): Promise<void> {
    await this.waitForLock(txId);
    return this.executeLocked(txId, async () => {
      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'DELETE',
        timestamp: Date.now(),
        state: BundleState.SETTLED,
        storages: {
          bundleStorage: false,
          secureStorage: false,
          merchantStorage: false,
        },
      });

      const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
      const json = await EncryptedStorage.getItem(MERCHANT_RECEIVED_KEY);
      if (json) {
        const payments: OfflineBundle[] = JSON.parse(json);
        const filtered = payments.filter(p => p.tx_id !== txId);
        await EncryptedStorage.setItem(MERCHANT_RECEIVED_KEY, JSON.stringify(filtered));
      }

      await attestationService.removeBundle(txId).catch(() => { });

      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'DELETE',
        timestamp: Date.now(),
        state: BundleState.SETTLED,
        storages: {
          bundleStorage: false,
          secureStorage: true,
          merchantStorage: true,
        },
      });

      await this.deleteTransactionState(txId);
    });
  }

  /**
   * Get current transaction state
   */
  async getTransactionState(txId: string): Promise<BundleTransaction | null> {
    const key = `${TRANSACTION_STATE_KEY}:${txId}`;
    const json = await EncryptedStorage.getItem(key);
    if (!json) {
      return null;
    }

    try {
      const parsed = JSON.parse(json) as SerializableBundleTransaction;
      return deserializeTransaction(parsed);
    } catch (err) {
      if (__DEV__) {
        console.error(`Failed to parse transaction state for ${txId}:`, err);
      }
      return null;
    }
  }

  /**
   * Get all transactions
   */
  async getAllTransactions(): Promise<BundleTransaction[]> {
    const index = await this.getTransactionIndex();
    const txIds = Array.from(index);

    const transactions = await Promise.all(
      txIds.map(async txId => {
        return this.getTransactionState(txId);
      })
    );

    return transactions.filter((t): t is BundleTransaction => t !== null);
  }

  /**
   * Get all stored bundles with metadata (used by AutoSettlementService)
   */
  async getAllStoredBundles(): Promise<Array<{
    bundle: OfflineBundle;
    metadata: BundleMetadata & { state: BundleState };
    payerAttestation?: AttestationEnvelope;
    merchantAttestation?: AttestationEnvelope;
  }>> {
    const transactions = await this.getAllTransactions();
    return transactions
      .filter(tx => tx.bundle && tx.metadata)
      .map(tx => ({
        bundle: tx.bundle!,
        metadata: { ...tx.metadata!, state: tx.state },
        payerAttestation: tx.payerAttestation,
        merchantAttestation: tx.merchantAttestation,
      }));
  }

  /**
   * Recover incomplete transactions on app startup
   */
  async recoverTransactions(): Promise<void> {
    if (this.recovering) {
      return;
    }

    this.recovering = true;

    try {
      const transactions = await this.getAllTransactions();
      const incompleteTransactions = transactions.filter(
        tx => tx.state === BundleState.PENDING || tx.state === BundleState.FAILED
      );

      if (__DEV__) {
        console.log(`Recovering ${incompleteTransactions.length} incomplete transactions`);
      }

      for (const transaction of incompleteTransactions) {
        try {
          // Check if bundle exists in all storages
          const [bundleExists, attestedBundle] = await Promise.all([
            this.checkBundleExists(transaction.id),
            attestationService.loadBundles().then(bundles => bundles.find(b => b.bundle.tx_id === transaction.id)),
          ]);

          if (bundleExists && attestedBundle) {
            // Complete transaction - mark as attested
            await this.updateBundleState(transaction.id, BundleState.ATTESTED);
          } else if (!bundleExists && !attestedBundle) {
            // Already cleaned up - delete transaction state
            await this.deleteTransactionState(transaction.id);
          } else {
            // Partial state - rollback
            if (__DEV__) {
              console.warn(`Incomplete transaction detected: ${transaction.id}, initiating rollback`);
            }
            await this.rollback(transaction.id, 'Partial state detected during recovery');
          }
        } catch (err) {
          if (__DEV__) {
            console.error(`Failed to recover transaction ${transaction.id}:`, err);
          }
        }
      }
    } finally {
      this.recovering = false;
    }
  }

  /**
   * Rollback a transaction
   */
  private async rollback(txId: string, reason: string): Promise<void> {
    try {
      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'ROLLBACK',
        timestamp: Date.now(),
        state: BundleState.ROLLBACK,
        storages: {
          bundleStorage: false,
          secureStorage: false,
        },
        error: reason,
      });

      // Remove from all storages (best effort)
      await Promise.all([
        bundleStorage.removeBundle(txId).catch(() => { }),
        attestationService.removeBundle(txId).catch(() => { }),
      ]);

      // Update transaction state to failed
      const transaction = await this.getTransactionState(txId);
      if (transaction) {
        transaction.state = BundleState.FAILED;
        transaction.error = reason;
        await this.saveTransactionState(transaction);
      }
    } catch (rollbackError) {
      if (__DEV__) {
        console.error(`Rollback failed for ${txId}:`, rollbackError);
      }
    }
  }

  /**
   * Rollback merchant receipt
   */
  private async rollbackMerchantReceipt(txId: string, reason: string): Promise<void> {
    try {
      await this.writeTransactionLog({
        transactionId: txId,
        operation: 'ROLLBACK',
        timestamp: Date.now(),
        state: BundleState.ROLLBACK,
        storages: {
          bundleStorage: false,
          secureStorage: false,
          merchantStorage: false,
        },
        error: reason,
      });

      // Remove from merchant storage
      const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
      const json = await EncryptedStorage.getItem(MERCHANT_RECEIVED_KEY);
      if (json) {
        const payments: OfflineBundle[] = JSON.parse(json);
        const filtered = payments.filter(p => p.tx_id !== txId);
        await EncryptedStorage.setItem(MERCHANT_RECEIVED_KEY, JSON.stringify(filtered));
      }

      // Remove from secure storage
      await attestationService.removeBundle(txId).catch(() => { });

      // Update transaction state to failed
      const transaction = await this.getTransactionState(txId);
      if (transaction) {
        transaction.state = BundleState.FAILED;
        transaction.error = reason;
        await this.saveTransactionState(transaction);
      }
    } catch (rollbackError) {
      if (__DEV__) {
        console.error(`Merchant receipt rollback failed for ${txId}:`, rollbackError);
      }
    }
  }

  /**
   * Check if bundle exists in BundleStorage
   */
  private async checkBundleExists(txId: string): Promise<boolean> {
    const bundles = await bundleStorage.loadBundles();
    return bundles.some(b => b.tx_id === txId);
  }

  /**
   * Write transaction log entry
   */
  private async writeTransactionLog(entry: TransactionLogEntry): Promise<void> {
    try {
      const json = await AsyncStorage.getItem(TRANSACTION_LOG_KEY);
      const log: TransactionLogEntry[] = json ? JSON.parse(json) : [];

      log.push(entry);

      // Keep only last 1000 entries to prevent unbounded growth
      const trimmedLog = log.slice(-1000);

      await AsyncStorage.setItem(TRANSACTION_LOG_KEY, JSON.stringify(trimmedLog));
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to write transaction log:', err);
      }
    }
  }

  /**
   * Save transaction state
   */
  private async saveTransactionState(transaction: BundleTransaction): Promise<void> {
    const key = `${TRANSACTION_STATE_KEY}:${transaction.id}`;
    const serialized = serializeTransaction(transaction);
    await EncryptedStorage.setItem(key, JSON.stringify(serialized));
    await this.addToIndex(transaction.id);
  }

  /**
   * Delete transaction state
   */
  private async deleteTransactionState(txId: string): Promise<void> {
    const key = `${TRANSACTION_STATE_KEY}:${txId}`;
    await EncryptedStorage.removeItem(key);
    await this.removeFromIndex(txId);
  }

  /**
   * Wait for existing lock to release
   */
  private async waitForLock(txId: string): Promise<void> {
    const existingLock = this.transactionLock.get(txId);
    if (existingLock) {
      await existingLock.catch(() => { }); // Ignore errors from previous operation
    }
  }

  /**
   * Execute operation with lock
   */
  private async executeLocked<T>(txId: string, operation: () => Promise<T>): Promise<T> {
    const promise = (async () => {
      try {
        return await operation();
      } finally {
        this.transactionLock.delete(txId);
      }
    })();

    this.transactionLock.set(txId, promise.then(() => { }, () => { }));
    return promise;
  }

  /**
   * Get transaction log (for debugging)
   */
  async getTransactionLog(): Promise<TransactionLogEntry[]> {
    const json = await AsyncStorage.getItem(TRANSACTION_LOG_KEY);
    return json ? JSON.parse(json) : [];
  }

  /**
   * Clear transaction log (for maintenance)
   */
  async clearTransactionLog(): Promise<void> {
    await AsyncStorage.removeItem(TRANSACTION_LOG_KEY);
  }
}

export const bundleTransactionManager = new BundleTransactionManager();
