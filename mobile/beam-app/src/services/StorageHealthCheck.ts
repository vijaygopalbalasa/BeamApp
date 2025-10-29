import AsyncStorage from '@react-native-async-storage/async-storage';
import { bundleStorage } from '../storage/BundleStorage';
import { attestationService } from './AttestationService';
import { bundleTransactionManager, BundleState } from '../storage/BundleTransactionManager';
import type { OfflineBundle } from '@beam/shared';

export interface StorageHealthReport {
  timestamp: number;
  healthy: boolean;
  issues: StorageIssue[];
  summary: {
    totalBundles: number;
    bundleStorageCount: number;
    secureStorageCount: number;
    merchantStorageCount: number;
    transactionStateCount: number;
    inconsistencies: number;
  };
}

export interface StorageIssue {
  severity: 'critical' | 'warning' | 'info';
  type: 'missing_bundle' | 'missing_attestation' | 'orphaned_transaction' | 'duplicate' | 'state_mismatch';
  bundleId: string;
  message: string;
  details?: any;
}

export interface RepairResult {
  success: boolean;
  repaired: number;
  failed: number;
  details: string[];
}

class StorageHealthCheck {
  /**
   * Run a comprehensive health check on all storage layers
   */
  async checkHealth(): Promise<StorageHealthReport> {
    const issues: StorageIssue[] = [];
    const timestamp = Date.now();

    try {
      // Load data from all storage layers
      const [bundleStorageBundles, attestedBundles, merchantBundles, transactions] = await Promise.all([
        bundleStorage.loadBundles(),
        attestationService.loadBundles(),
        this.loadMerchantBundles(),
        bundleTransactionManager.getAllTransactions(),
      ]);

      // Build bundle ID sets for quick lookup
      const bundleStorageIds = new Set(bundleStorageBundles.map(b => b.tx_id));
      const secureStorageIds = new Set(attestedBundles.map(b => b.bundle.tx_id));
      const merchantStorageIds = new Set(merchantBundles.map(b => b.tx_id));
      const transactionIds = new Set(transactions.map(t => t.id));

      // Check 1: Bundles in BundleStorage should have matching SecureStorage entries
      for (const bundle of bundleStorageBundles) {
        if (!secureStorageIds.has(bundle.tx_id)) {
          issues.push({
            severity: 'critical',
            type: 'missing_attestation',
            bundleId: bundle.tx_id,
            message: 'Bundle exists in BundleStorage but missing in SecureStorage',
            details: { amount: bundle.token.amount, nonce: bundle.nonce },
          });
        }
      }

      // Check 2: Attested bundles should have transaction state
      for (const attested of attestedBundles) {
        const bundleId = attested.bundle.tx_id;

        // Check if payer bundle has corresponding BundleStorage entry
        if (attested.payerAttestation && !bundleStorageIds.has(bundleId)) {
          issues.push({
            severity: 'warning',
            type: 'missing_bundle',
            bundleId,
            message: 'Payer bundle in SecureStorage but missing in BundleStorage',
          });
        }

        // Check if merchant bundle has corresponding MerchantStorage entry
        if (attested.merchantAttestation && !merchantStorageIds.has(bundleId)) {
          issues.push({
            severity: 'warning',
            type: 'missing_bundle',
            bundleId,
            message: 'Merchant bundle in SecureStorage but missing in MerchantStorage',
          });
        }

        // Check for transaction state
        if (!transactionIds.has(bundleId)) {
          issues.push({
            severity: 'info',
            type: 'orphaned_transaction',
            bundleId,
            message: 'Bundle exists but has no transaction state record',
          });
        }
      }

      // Check 3: Transaction states should have corresponding bundles
      for (const transaction of transactions) {
        if (transaction.state === BundleState.PENDING || transaction.state === BundleState.ATTESTED) {
          if (!secureStorageIds.has(transaction.id)) {
            issues.push({
              severity: 'critical',
              type: 'state_mismatch',
              bundleId: transaction.id,
              message: `Transaction state is ${transaction.state} but bundle not found in storage`,
              details: { state: transaction.state, timestamp: transaction.timestamp },
            });
          }
        }
      }

      // Check 4: Check for duplicates across merchant and payer storage
      const allBundleIds = [
        ...bundleStorageIds,
        ...merchantStorageIds,
      ];
      const duplicates = allBundleIds.filter((id, index) => allBundleIds.indexOf(id) !== index);

      for (const bundleId of duplicates) {
        if (bundleStorageIds.has(bundleId) && merchantStorageIds.has(bundleId)) {
          issues.push({
            severity: 'warning',
            type: 'duplicate',
            bundleId,
            message: 'Bundle exists in both payer and merchant storage (possible double-spend attempt)',
          });
        }
      }

      // Check 5: Verify merchant bundles have attestations
      for (const bundle of merchantBundles) {
        const attestedBundle = attestedBundles.find(a => a.bundle.tx_id === bundle.tx_id);
        if (!attestedBundle || !attestedBundle.merchantAttestation) {
          issues.push({
            severity: 'critical',
            type: 'missing_attestation',
            bundleId: bundle.tx_id,
            message: 'Merchant receipt exists but missing merchant attestation',
          });
        }
      }

      const summary = {
        totalBundles: new Set([...bundleStorageIds, ...secureStorageIds, ...merchantStorageIds]).size,
        bundleStorageCount: bundleStorageIds.size,
        secureStorageCount: secureStorageIds.size,
        merchantStorageCount: merchantStorageIds.size,
        transactionStateCount: transactionIds.size,
        inconsistencies: issues.length,
      };

      const healthy = issues.filter(i => i.severity === 'critical').length === 0;

      return {
        timestamp,
        healthy,
        issues,
        summary,
      };
    } catch (err) {
      if (__DEV__) {
        console.error('Health check failed:', err);
      }

      return {
        timestamp,
        healthy: false,
        issues: [
          {
            severity: 'critical',
            type: 'state_mismatch',
            bundleId: 'SYSTEM',
            message: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        summary: {
          totalBundles: 0,
          bundleStorageCount: 0,
          secureStorageCount: 0,
          merchantStorageCount: 0,
          transactionStateCount: 0,
          inconsistencies: 1,
        },
      };
    }
  }

  /**
   * Attempt to repair inconsistencies automatically
   */
  async repairInconsistencies(report?: StorageHealthReport): Promise<RepairResult> {
    const healthReport = report || (await this.checkHealth());
    const details: string[] = [];
    let repaired = 0;
    let failed = 0;

    for (const issue of healthReport.issues) {
      try {
        switch (issue.type) {
          case 'missing_attestation':
            // Critical: Bundle in BundleStorage but missing attestation
            // Solution: Remove from BundleStorage or re-attest
            if (issue.message.includes('BundleStorage but missing in SecureStorage')) {
              await bundleStorage.removeBundle(issue.bundleId);
              details.push(`Removed orphaned bundle ${issue.bundleId} from BundleStorage`);
              repaired++;
            } else if (issue.message.includes('missing merchant attestation')) {
              // Cannot auto-repair merchant attestations - requires merchant signature
              details.push(`Cannot auto-repair merchant attestation for ${issue.bundleId}`);
              failed++;
            }
            break;

          case 'missing_bundle':
            // Warning: Attestation exists but bundle missing from storage
            // Solution: Add bundle back or remove attestation
            await attestationService.removeBundle(issue.bundleId);
            details.push(`Removed orphaned attestation ${issue.bundleId} from SecureStorage`);
            repaired++;
            break;

          case 'orphaned_transaction':
            // Info: Bundle exists but no transaction state
            // Solution: Create transaction state or ignore (it's just metadata)
            details.push(`Skipped creating transaction state for ${issue.bundleId} (info level)`);
            break;

          case 'state_mismatch':
            // Critical: Transaction state says bundle exists but it doesn't
            // Solution: Remove transaction state or rollback
            await bundleTransactionManager.deleteBundle(issue.bundleId).catch(() => {});
            details.push(`Cleaned up mismatched transaction state for ${issue.bundleId}`);
            repaired++;
            break;

          case 'duplicate':
            // Warning: Bundle in both payer and merchant storage
            // Solution: Keep in appropriate storage based on role
            details.push(`Duplicate bundle detected: ${issue.bundleId} - manual review required`);
            failed++;
            break;

          default:
            details.push(`Unknown issue type for ${issue.bundleId}`);
            failed++;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        details.push(`Failed to repair ${issue.bundleId}: ${errorMessage}`);
        failed++;
      }
    }

    return {
      success: failed === 0,
      repaired,
      failed,
      details,
    };
  }

  /**
   * Verify a specific bundle exists in all required storages
   */
  async verifyBundle(bundleId: string): Promise<{
    exists: boolean;
    locations: {
      bundleStorage: boolean;
      secureStorage: boolean;
      merchantStorage: boolean;
      transactionState: boolean;
    };
  }> {
    const [bundleExists, attestedBundle, merchantBundles, transaction] = await Promise.all([
      bundleStorage.loadBundles().then(bundles => bundles.some(b => b.tx_id === bundleId)),
      attestationService.loadBundles().then(bundles => bundles.find(b => b.bundle.tx_id === bundleId)),
      this.loadMerchantBundles().then(bundles => bundles.some(b => b.tx_id === bundleId)),
      bundleTransactionManager.getTransactionState(bundleId),
    ]);

    return {
      exists: bundleExists || Boolean(attestedBundle) || merchantBundles,
      locations: {
        bundleStorage: bundleExists,
        secureStorage: Boolean(attestedBundle),
        merchantStorage: merchantBundles,
        transactionState: Boolean(transaction),
      },
    };
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    bundleStorage: { count: number; sizeBytes?: number };
    secureStorage: { count: number; sizeBytes?: number };
    merchantStorage: { count: number; sizeBytes?: number };
    transactionLog: { count: number; sizeBytes?: number };
    transactionStates: { count: number; sizeBytes?: number };
  }> {
    const [bundleStorageBundles, attestedBundles, merchantBundles, transactions, transactionLog] = await Promise.all([
      bundleStorage.loadBundles(),
      attestationService.loadBundles(),
      this.loadMerchantBundles(),
      bundleTransactionManager.getAllTransactions(),
      bundleTransactionManager.getTransactionLog(),
    ]);

    return {
      bundleStorage: {
        count: bundleStorageBundles.length,
        sizeBytes: this.estimateSize(bundleStorageBundles),
      },
      secureStorage: {
        count: attestedBundles.length,
        sizeBytes: this.estimateSize(attestedBundles),
      },
      merchantStorage: {
        count: merchantBundles.length,
        sizeBytes: this.estimateSize(merchantBundles),
      },
      transactionLog: {
        count: transactionLog.length,
        sizeBytes: this.estimateSize(transactionLog),
      },
      transactionStates: {
        count: transactions.length,
        sizeBytes: this.estimateSize(transactions),
      },
    };
  }

  /**
   * Clean up old settled transactions and logs
   */
  async cleanupOldData(olderThanMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffTime = Date.now() - olderThanMs;
    let cleaned = 0;

    // Clean up old transaction states
    const transactions = await bundleTransactionManager.getAllTransactions();
    for (const transaction of transactions) {
      if (
        transaction.timestamp < cutoffTime &&
        (transaction.state === BundleState.SETTLED || transaction.state === BundleState.FAILED)
      ) {
        await bundleTransactionManager.deleteBundle(transaction.id).catch(() => {});
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Load merchant received bundles from AsyncStorage
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
   * Estimate size of data in bytes (rough estimate)
   */
  private estimateSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }
}

export const storageHealthCheck = new StorageHealthCheck();
