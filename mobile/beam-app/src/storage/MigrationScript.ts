import AsyncStorage from '@react-native-async-storage/async-storage';
import { bundleStorage } from './BundleStorage';
import { attestationService } from '../services/AttestationService';
import { bundleTransactionManager, BundleState, type BundleTransaction } from './BundleTransactionManager';
import { storageHealthCheck } from '../services/StorageHealthCheck';
import type { OfflineBundle } from '@beam/shared';

const MIGRATION_VERSION_KEY = '@beam:migration_version';
const CURRENT_MIGRATION_VERSION = 1;

export interface MigrationResult {
  success: boolean;
  version: number;
  migratedBundles: number;
  migratedReceipts: number;
  errors: string[];
  duration: number;
}

class MigrationScript {
  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      version: CURRENT_MIGRATION_VERSION,
      migratedBundles: 0,
      migratedReceipts: 0,
      errors: [],
      duration: 0,
    };

    try {
      const currentVersion = await this.getCurrentMigrationVersion();

      if (currentVersion >= CURRENT_MIGRATION_VERSION) {
        if (__DEV__) {
          console.log('No migrations needed - already at version', currentVersion);
        }
        result.duration = Date.now() - startTime;
        return result;
      }

      if (__DEV__) {
        console.log(`Running migrations from version ${currentVersion} to ${CURRENT_MIGRATION_VERSION}`);
      }

      // Run migration v1: Create transaction states for existing bundles
      if (currentVersion < 1) {
        await this.migrateToV1(result);
      }

      // Save migration version
      await this.setMigrationVersion(CURRENT_MIGRATION_VERSION);

      result.duration = Date.now() - startTime;

      if (__DEV__) {
        console.log('Migration completed:', result);
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.success = false;
      result.errors.push(`Migration failed: ${errorMessage}`);
      result.duration = Date.now() - startTime;

      if (__DEV__) {
        console.error('Migration failed:', err);
      }

      return result;
    }
  }

  /**
   * Migration v1: Create transaction states for existing bundles
   * This migration creates BundleTransaction records for all existing bundles
   * to enable the new atomic transaction system
   */
  private async migrateToV1(result: MigrationResult): Promise<void> {
    if (__DEV__) {
      console.log('Running migration v1: Creating transaction states for existing bundles');
    }

    try {
      // Load existing bundles from all storages
      const [bundleStorageBundles, attestedBundles, merchantBundles] = await Promise.all([
        bundleStorage.loadBundles(),
        attestationService.loadBundles(),
        this.loadMerchantBundles(),
      ]);

      // Migrate payer bundles (from BundleStorage)
      for (const bundle of bundleStorageBundles) {
        try {
          // Check if transaction state already exists
          const existingTransaction = await bundleTransactionManager.getTransactionState(bundle.tx_id);
          if (existingTransaction) {
            if (__DEV__) {
              console.log(`Transaction state already exists for ${bundle.tx_id}, skipping`);
            }
            continue;
          }

          // Find corresponding attested bundle
          const attestedBundle = attestedBundles.find(a => a.bundle.tx_id === bundle.tx_id);

          // Create transaction state
          const transaction: BundleTransaction = {
            id: bundle.tx_id,
            state: BundleState.ATTESTED,
            timestamp: bundle.timestamp,
            bundle,
            metadata: attestedBundle?.metadata || {
              amount: bundle.token.amount,
              currency: bundle.token.symbol,
              merchantPubkey: bundle.merchant_pubkey,
              payerPubkey: bundle.payer_pubkey,
              nonce: bundle.nonce,
              createdAt: bundle.timestamp,
            },
            payerAttestation: attestedBundle?.payerAttestation,
            merchantAttestation: attestedBundle?.merchantAttestation,
            retryCount: 0,
          };

          // Save transaction state directly (bypass createBundle to avoid duplicate writes)
          await AsyncStorage.setItem(
            `@beam:transaction_state:${transaction.id}`,
            JSON.stringify(transaction)
          );

          result.migratedBundles++;

          if (__DEV__) {
            console.log(`Migrated payer bundle ${bundle.tx_id}`);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to migrate bundle ${bundle.tx_id}: ${errorMessage}`);

          if (__DEV__) {
            console.error(`Failed to migrate bundle ${bundle.tx_id}:`, err);
          }
        }
      }

      // Migrate merchant receipts
      for (const bundle of merchantBundles) {
        try {
          // Skip if already migrated as payer bundle
          const existingTransaction = await bundleTransactionManager.getTransactionState(bundle.tx_id);
          if (existingTransaction) {
            if (__DEV__) {
              console.log(`Transaction state already exists for merchant receipt ${bundle.tx_id}, skipping`);
            }
            continue;
          }

          // Find corresponding attested bundle
          const attestedBundle = attestedBundles.find(a => a.bundle.tx_id === bundle.tx_id);

          // Create transaction state
          const transaction: BundleTransaction = {
            id: bundle.tx_id,
            state: BundleState.ATTESTED,
            timestamp: bundle.timestamp,
            bundle,
            metadata: attestedBundle?.metadata || {
              amount: bundle.token.amount,
              currency: bundle.token.symbol,
              merchantPubkey: bundle.merchant_pubkey,
              payerPubkey: bundle.payer_pubkey,
              nonce: bundle.nonce,
              createdAt: bundle.timestamp,
            },
            payerAttestation: attestedBundle?.payerAttestation,
            merchantAttestation: attestedBundle?.merchantAttestation,
            retryCount: 0,
          };

          // Save transaction state directly
          await AsyncStorage.setItem(
            `@beam:transaction_state:${transaction.id}`,
            JSON.stringify(transaction)
          );

          result.migratedReceipts++;

          if (__DEV__) {
            console.log(`Migrated merchant receipt ${bundle.tx_id}`);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to migrate merchant receipt ${bundle.tx_id}: ${errorMessage}`);

          if (__DEV__) {
            console.error(`Failed to migrate merchant receipt ${bundle.tx_id}:`, err);
          }
        }
      }

      if (__DEV__) {
        console.log(`Migration v1 complete: ${result.migratedBundles} bundles, ${result.migratedReceipts} receipts`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.errors.push(`Migration v1 failed: ${errorMessage}`);
      throw err;
    }
  }

  /**
   * Get current migration version
   */
  private async getCurrentMigrationVersion(): Promise<number> {
    try {
      const version = await AsyncStorage.getItem(MIGRATION_VERSION_KEY);
      return version ? parseInt(version, 10) : 0;
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to get migration version:', err);
      }
      return 0;
    }
  }

  /**
   * Set migration version
   */
  private async setMigrationVersion(version: number): Promise<void> {
    await AsyncStorage.setItem(MIGRATION_VERSION_KEY, version.toString());
  }

  /**
   * Load merchant bundles from AsyncStorage
   */
  private async loadMerchantBundles(): Promise<OfflineBundle[]> {
    try {
      const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
      const json = await AsyncStorage.getItem(MERCHANT_RECEIVED_KEY);
      if (!json) {
        return [];
      }
      return JSON.parse(json);
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to load merchant bundles:', err);
      }
      return [];
    }
  }

  /**
   * Verify migration integrity after completion
   */
  async verifyMigration(): Promise<{
    valid: boolean;
    issues: string[];
    summary: {
      totalBundles: number;
      bundlesWithTransactionState: number;
      bundlesWithoutTransactionState: number;
    };
  }> {
    const issues: string[] = [];

    // Run health check
    const healthReport = await storageHealthCheck.checkHealth();

    // Count bundles with and without transaction states
    const [bundleStorageBundles, attestedBundles, merchantBundles, transactions] = await Promise.all([
      bundleStorage.loadBundles(),
      attestationService.loadBundles(),
      this.loadMerchantBundles(),
      bundleTransactionManager.getAllTransactions(),
    ]);

    const allBundleIds = new Set([
      ...bundleStorageBundles.map(b => b.tx_id),
      ...attestedBundles.map(b => b.bundle.tx_id),
      ...merchantBundles.map(b => b.tx_id),
    ]);

    const transactionIds = new Set(transactions.map(t => t.id));

    let bundlesWithoutTransactionState = 0;
    for (const bundleId of allBundleIds) {
      if (!transactionIds.has(bundleId)) {
        bundlesWithoutTransactionState++;
        issues.push(`Bundle ${bundleId} has no transaction state`);
      }
    }

    return {
      valid: bundlesWithoutTransactionState === 0 && healthReport.healthy,
      issues: [...issues, ...healthReport.issues.map(i => i.message)],
      summary: {
        totalBundles: allBundleIds.size,
        bundlesWithTransactionState: transactionIds.size,
        bundlesWithoutTransactionState,
      },
    };
  }

  /**
   * Reset migration (for testing only - deletes all transaction states)
   */
  async resetMigration(): Promise<void> {
    if (!__DEV__) {
      throw new Error('Reset migration is only available in development mode');
    }

    await AsyncStorage.setItem(MIGRATION_VERSION_KEY, '0');

    // Delete all transaction states
    const keys = await AsyncStorage.getAllKeys();
    const transactionStateKeys = keys.filter(key => key.startsWith('@beam:transaction_state:'));
    await AsyncStorage.multiRemove(transactionStateKeys);

    // Clear transaction log
    await bundleTransactionManager.clearTransactionLog();

    if (__DEV__) {
      console.log('Migration reset complete');
    }
  }
}

export const migrationScript = new MigrationScript();

/**
 * Run migrations on app startup
 * Should be called from App.tsx or WalletManager initialization
 */
export async function runStartupMigrations(): Promise<MigrationResult> {
  if (__DEV__) {
    console.log('Running startup migrations...');
  }

  const result = await migrationScript.runMigrations();

  if (!result.success) {
    if (__DEV__) {
      console.error('Startup migrations failed:', result.errors);
    }
  } else if (__DEV__) {
    console.log(`Startup migrations completed successfully in ${result.duration}ms`);
  }

  return result;
}
