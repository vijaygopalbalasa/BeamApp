/**
 * Attestation Integration Service
 *
 * Orchestrates the complete attestation flow for offline payment bundles:
 * 1. Get device info from PlayIntegrityService
 * 2. Request integrity token
 * 3. Create bundle hash
 * 4. Request attestation from verifier backend
 * 5. Return complete attestation envelope
 */

import { playIntegrityService } from './PlayIntegrityService';
import { verifierService } from './VerifierService';
import type { OfflineBundle } from '@beam/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Buffer } from 'buffer';

export class AttestationIntegrationService {
  /**
   * Create attestation envelope for a payment bundle
   */
  async createAttestation(bundle: OfflineBundle): Promise<{
    nonce: string;
    attestationReport: string;
    signature: string;
    certificateChain: string[];
    deviceInfo: {
      model: string;
      osVersion: string;
      securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
    };
  }> {
    console.log('[AttestationIntegration] Creating attestation for bundle:', bundle.tx_id);

    try {
      // Step 1: Get device information
      let deviceInfo = await playIntegrityService.getDeviceInfo().catch(err => {
        console.warn('[AttestationIntegration] ⚠️ Failed to get device info, using fallback', err);
        return {
          model: 'Unknown Android Device',
          osVersion: 'unknown',
          securityLevel: 'SOFTWARE' as const,
          manufacturer: 'unknown',
          device: 'unknown',
          fingerprint: 'unknown',
          sdkVersion: 0,
        };
      });
      console.log('[AttestationIntegration] Device info:', {
        model: deviceInfo.model,
        securityLevel: deviceInfo.securityLevel,
      });

      // Step 2: Create bundle hash
      const bundleHash = this.createBundleHash(bundle);
      console.log('[AttestationIntegration] Bundle hash:', bundleHash.substring(0, 16) + '...');

      // Step 3: Generate nonce for integrity token
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = Buffer.from(nonceBytes).toString('base64');

      // Step 4: Request Play Integrity token
      let integrityToken: string | null = null;
      try {
        integrityToken = await playIntegrityService.requestIntegrityToken(nonce);
        console.log('[AttestationIntegration] ✅ Integrity token received');
      } catch (tokenError) {
        if (playIntegrityService.isDevMode()) {
          console.warn('[AttestationIntegration] ⚠️ Integrity token unavailable, using dev token');
          integrityToken = `dev_${bundle.tx_id}_${Date.now()}`;
        } else {
          throw tokenError;
        }
      }

      if (!integrityToken) {
        throw new Error('Integrity token unavailable');
      }

      // Step 5: Request attestation from verifier backend
      const envelope = await verifierService.requestAttestation({
        bundleId: bundle.tx_id,
        deviceToken: integrityToken,
        bundleHash,
        timestamp: bundle.timestamp,
        deviceInfo: {
          model: deviceInfo.model || 'Unknown Android Device',
          osVersion: deviceInfo.osVersion || 'unknown',
          securityLevel: deviceInfo.securityLevel ?? 'SOFTWARE',
        },
        payer: bundle.payer_pubkey,
        merchant: bundle.merchant_pubkey,
        amount: bundle.token.amount,
        nonce: bundle.nonce,
      });

      console.log('[AttestationIntegration] ✅ Attestation envelope received');

      return {
        nonce: envelope.nonce,
        attestationReport: envelope.attestationReport,
        signature: envelope.signature,
        certificateChain: envelope.certificateChain,
        deviceInfo: envelope.deviceInfo,
      };
    } catch (error) {
      console.error('[AttestationIntegration] ❌ Failed to create attestation:', error);
      throw error;
    }
  }

  /**
   * Verify an attestation envelope
   */
  async verifyAttestation(
    bundleId: string,
    attestationReport: string,
    signature: string
  ): Promise<boolean> {
    console.log('[AttestationIntegration] Verifying attestation for bundle:', bundleId);

    try {
      const result = await verifierService.verifyAttestation({
        bundleId,
        attestationReport,
        signature,
      });

      console.log('[AttestationIntegration] Verification result:', result.valid ? '✅ Valid' : '❌ Invalid');

      return result.valid;
    } catch (error) {
      console.error('[AttestationIntegration] ❌ Verification failed:', error);
      return false;
    }
  }

  /**
   * Report a fraudulent bundle
   */
  async reportFraud(bundleId: string, reason: string): Promise<void> {
    console.log('[AttestationIntegration] Reporting fraud for bundle:', bundleId);

    try {
      // Get device ID for fraud reporting
      await playIntegrityService.getDeviceId();

      // Generate device token for this fraud report
      const rand = new Uint8Array(32);
      crypto.getRandomValues(rand);
      const nonce = Buffer.from(rand).toString('base64');
      const deviceToken = await playIntegrityService.requestIntegrityToken(nonce);

      await verifierService.reportFraud({
        deviceToken,
        bundleId,
        reason,
      });

      console.log('[AttestationIntegration] ✅ Fraud reported successfully');
    } catch (error) {
      console.error('[AttestationIntegration] ❌ Failed to report fraud:', error);
      throw error;
    }
  }

  /**
   * Check device reputation
   */
  async checkDeviceReputation(): Promise<{
    reputationScore: number;
    totalTransactions: number;
    fraudReports: number;
    blacklisted: boolean;
  }> {
    console.log('[AttestationIntegration] Checking device reputation');

    try {
      const deviceId = await playIntegrityService.getDeviceId();
      const reputation = await verifierService.getReputation(deviceId);

      console.log('[AttestationIntegration] Reputation score:', reputation.reputationScore);

      return {
        reputationScore: reputation.reputationScore,
        totalTransactions: reputation.totalTransactions,
        fraudReports: reputation.fraudReports,
        blacklisted: reputation.blacklisted,
      };
    } catch (error) {
      console.error('[AttestationIntegration] ❌ Failed to check reputation:', error);
      throw error;
    }
  }

  /**
   * Check if verifier service is available
   */
  async checkVerifierHealth(): Promise<boolean> {
    try {
      const health = await verifierService.healthCheck();
      return health.status === 'ok';
    } catch (error) {
      console.error('[AttestationIntegration] ❌ Verifier health check failed:', error);
      return false;
    }
  }

  /**
   * Create SHA-256 hash of bundle for attestation
   */
  private createBundleHash(bundle: OfflineBundle): string {
    // Create deterministic JSON representation
    const canonicalBundle = JSON.stringify(
      {
        tx_id: bundle.tx_id,
        escrow_pda: bundle.escrow_pda,
        payer_pubkey: bundle.payer_pubkey,
        merchant_pubkey: bundle.merchant_pubkey,
        token: bundle.token,
        nonce: bundle.nonce,
        timestamp: bundle.timestamp,
      },
      null,
      0 // No whitespace
    );

    // Create SHA-256 hash using noble
    const hashBytes = sha256(new TextEncoder().encode(canonicalBundle));
    return bytesToHex(hashBytes);
  }
}

// Singleton instance
export const attestationIntegration = new AttestationIntegrationService();
