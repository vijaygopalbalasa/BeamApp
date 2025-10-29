import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { sign } from '@noble/ed25519';
import { VERIFIER_SIGNING_KEY, VERIFIER_PUBLIC_KEY, VERIFIER_ALLOW_DEV } from '../env.js';
import { verifyPlayIntegrityToken, isPlayIntegrityConfigured } from './playintegrity.js';

/**
 * Attestation Service - Hardware Attestation Verification
 *
 * Validates Play Integrity API tokens and issues signed attestation envelopes
 * for secure offline payment bundles.
 */

export interface AttestationRequest {
  bundleId: string;
  deviceToken: string; // Play Integrity API token
  bundleHash: string;
  timestamp: number;
  deviceInfo: {
    model: string;
    osVersion: string;
    securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  };
}

export interface AttestationEnvelope {
  bundleId: string;
  timestamp: number;
  nonce: Buffer;
  attestationReport: Buffer;
  signature: Buffer;
  certificateChain: Buffer[];
  deviceInfo: {
    model: string;
    osVersion: string;
    securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  };
}

export interface DeviceReputation {
  deviceId: string;
  reputationScore: number;
  totalTransactions: number;
  fraudReports: number;
  lastSeen: number;
  blacklisted: boolean;
}

class AttestationService {
  private verifierPrivateKey: Uint8Array;
  private verifierPublicKey: Uint8Array;
  private deviceReputations = new Map<string, DeviceReputation>();
  private attestationCache = new Map<string, AttestationEnvelope>();

  constructor() {
    // Load from environment variables
    this.verifierPrivateKey = VERIFIER_SIGNING_KEY;
    this.verifierPublicKey = VERIFIER_PUBLIC_KEY;

    console.log('[AttestationService] Initialized with verifier key from env');
    console.log('[AttestationService] Public key:', Buffer.from(this.verifierPublicKey).toString('hex').slice(0, 16) + '...');

    if (VERIFIER_ALLOW_DEV) {
      console.warn('[AttestationService] ⚠️  DEV MODE ENABLED - unsigned attestations allowed');
    }
  }

  /**
   * Validate Play Integrity API token and issue attestation envelope
   */
  async validateAndAttest(request: AttestationRequest): Promise<AttestationEnvelope> {
    console.log(`[AttestationService] Validating attestation for bundle ${request.bundleId}`);

    // Check cache first
    if (this.attestationCache.has(request.bundleId)) {
      console.log(`[AttestationService] Returning cached attestation for ${request.bundleId}`);
      return this.attestationCache.get(request.bundleId)!;
    }

    // Step 1: Validate Play Integrity token
    const integrityValidation = await this.validatePlayIntegrity(request.deviceToken);
    if (!integrityValidation.valid) {
      throw new Error(`Play Integrity validation failed: ${integrityValidation.reason}`);
    }

    // Step 2: Check device reputation
    const deviceId = this.extractDeviceId(request.deviceToken);
    const reputation = this.getDeviceReputation(deviceId);

    if (reputation.blacklisted) {
      throw new Error('Device is blacklisted due to fraudulent activity');
    }

    if (reputation.reputationScore < -10) {
      throw new Error('Device reputation too low for attestation');
    }

    // Step 3: Generate attestation report
    const nonce = crypto.randomBytes(32);
    const attestationReport = this.createAttestationReport({
      bundleId: request.bundleId,
      bundleHash: request.bundleHash,
      timestamp: request.timestamp,
      nonce,
      deviceInfo: request.deviceInfo,
      integrityValidation,
    });

    // Step 4: Sign attestation with verifier's key
    const signature = await this.signAttestation(attestationReport);

    // Step 5: Build certificate chain
    const certificateChain = this.buildCertificateChain();

    // Step 6: Create envelope
    const envelope: AttestationEnvelope = {
      bundleId: request.bundleId,
      timestamp: Date.now(),
      nonce,
      attestationReport,
      signature,
      certificateChain,
      deviceInfo: request.deviceInfo,
    };

    // Update device reputation (positive)
    this.updateDeviceReputation(deviceId, +1);

    // Cache the envelope (1 hour TTL)
    this.attestationCache.set(request.bundleId, envelope);
    setTimeout(() => this.attestationCache.delete(request.bundleId), 3600000);

    console.log(`[AttestationService] ✅ Issued attestation for bundle ${request.bundleId}`);

    return envelope;
  }

  /**
   * Validate Play Integrity API token
   */
  private async validatePlayIntegrity(token: string): Promise<{ valid: boolean; reason?: string; deviceVerdict?: string[] }> {
    if (!token || token.length < 10) {
      return { valid: false, reason: 'Invalid token format' };
    }

    // For development mode, accept tokens starting with "dev_"
    if (VERIFIER_ALLOW_DEV && token.startsWith('dev_')) {
      console.log('[AttestationService] DEV MODE: Accepting dev token');
      return { valid: true, deviceVerdict: ['DEV_MODE'] };
    }

    // Use real Play Integrity API if configured
    if (isPlayIntegrityConfigured()) {
      console.log('[AttestationService] Verifying Play Integrity token with Google API');
      const result = await verifyPlayIntegrityToken(token);

      if (!result.success) {
        console.warn('[AttestationService] Play Integrity verification failed:', result.error);
        return {
          valid: false,
          reason: result.errorDetails || result.error || 'Play Integrity verification failed',
        };
      }

      console.log('[AttestationService] Play Integrity verified:', result.deviceVerdict?.join(', '));
      return {
        valid: true,
        deviceVerdict: result.deviceVerdict,
      };
    }

    // Fallback for development when Play Integrity is not configured
    if (VERIFIER_ALLOW_DEV) {
      console.warn('[AttestationService] Play Integrity not configured, allowing in dev mode');
      return { valid: true, deviceVerdict: ['DEV_MODE_UNCONFIGURED'] };
    }

    return {
      valid: false,
      reason: 'Play Integrity API not configured and dev mode is disabled',
    };
  }

  /**
   * Create attestation report with all validation data
   */
  private createAttestationReport(data: {
    bundleId: string;
    bundleHash: string;
    timestamp: number;
    nonce: Buffer;
    deviceInfo: any;
    integrityValidation: any;
  }): Buffer {
    const report = {
      version: 1,
      bundleId: data.bundleId,
      bundleHash: data.bundleHash,
      timestamp: data.timestamp,
      nonce: data.nonce.toString('base64'),
      deviceInfo: data.deviceInfo,
      integrityCheck: {
        valid: data.integrityValidation.valid,
        timestamp: Date.now(),
      },
      verifier: {
        publicKey: Buffer.from(this.verifierPublicKey).toString('base64'),
        timestamp: Date.now(),
      },
    };

    return Buffer.from(JSON.stringify(report), 'utf-8');
  }

  /**
   * Sign attestation report with verifier's Ed25519 key
   */
  private async signAttestation(attestationReport: Buffer): Promise<Buffer> {
    // Use @noble/ed25519 for signing
    const signature = await sign(attestationReport, this.verifierPrivateKey);
    return Buffer.from(signature);
  }

  /**
   * Build certificate chain for verification
   * In production, this would include intermediate and root certificates
   */
  private buildCertificateChain(): Buffer[] {
    // Simplified for development
    // In production, return actual X.509 certificate chain
    return [Buffer.from(this.verifierPublicKey)];
  }

  /**
   * Extract device ID from Play Integrity token
   */
  private extractDeviceId(token: string): string {
    // In production, extract from decoded JWT
    // For now, use hash of token
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get device reputation
   */
  private getDeviceReputation(deviceId: string): DeviceReputation {
    if (!this.deviceReputations.has(deviceId)) {
      this.deviceReputations.set(deviceId, {
        deviceId,
        reputationScore: 0,
        totalTransactions: 0,
        fraudReports: 0,
        lastSeen: Date.now(),
        blacklisted: false,
      });
    }

    return this.deviceReputations.get(deviceId)!;
  }

  /**
   * Update device reputation (positive or negative)
   */
  private updateDeviceReputation(deviceId: string, delta: number): void {
    const reputation = this.getDeviceReputation(deviceId);
    reputation.reputationScore += delta;
    reputation.totalTransactions += delta > 0 ? 1 : 0;
    reputation.fraudReports += delta < 0 ? 1 : 0;
    reputation.lastSeen = Date.now();

    // Auto-blacklist if too many fraud reports
    if (reputation.fraudReports >= 3) {
      reputation.blacklisted = true;
      console.log(`[AttestationService] ⚠️ Device ${deviceId} blacklisted due to fraud reports`);
    }

    console.log(`[AttestationService] Updated reputation for ${deviceId}: ${reputation.reputationScore}`);
  }

  /**
   * Report fraudulent bundle
   */
  reportFraud(deviceId: string, bundleId: string, reason: string): void {
    console.log(`[AttestationService] Fraud reported: ${deviceId} - ${bundleId} - ${reason}`);
    this.updateDeviceReputation(deviceId, -5);

    // Invalidate cached attestation
    this.attestationCache.delete(bundleId);
  }

  /**
   * Get reputation for a device
   */
  getReputation(deviceId: string): DeviceReputation {
    return this.getDeviceReputation(deviceId);
  }

  /**
   * Get all blacklisted devices
   */
  getBlacklistedDevices(): DeviceReputation[] {
    return Array.from(this.deviceReputations.values()).filter(d => d.blacklisted);
  }

  /**
   * Verify an attestation envelope signature
   */
  async verifyAttestationSignature(envelope: AttestationEnvelope): Promise<boolean> {
    try {
      const { verify } = await import('@noble/ed25519');
      const verified = await verify(
        envelope.signature,
        envelope.attestationReport,
        this.verifierPublicKey
      );

      return verified;
    } catch (err) {
      console.error('[AttestationService] Signature verification failed:', err);
      return false;
    }
  }
}

// Singleton instance
export const attestationService = new AttestationService();
