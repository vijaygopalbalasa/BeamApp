/**
 * Verifier Service - Hardware Attestation Integration
 *
 * Communicates with the backend verifier service to:
 * - Request attestation envelopes for payment bundles
 * - Verify attestation signatures
 * - Report fraudulent bundles
 * - Query device reputation
 */

import { Config } from '../config';

export interface AttestationRequest {
  bundleId: string;
  deviceToken: string;
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
  nonce: string; // base64
  attestationReport: string; // base64
  signature: string; // base64
  certificateChain: string[]; // base64[]
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

export interface VerifyAttestationRequest {
  bundleId: string;
  attestationReport: string; // base64
  signature: string; // base64
}

export interface VerifyAttestationResponse {
  valid: boolean;
  bundleId: string;
  timestamp: number;
}

export interface ReportFraudRequest {
  deviceToken: string;
  bundleId: string;
  reason: string;
}

class VerifierService {
  private baseUrl: string;
  private timeout: number = 15000; // 15 seconds

  constructor() {
    this.baseUrl = Config.services.verifier;
    console.log('[VerifierService] Initialized with baseUrl:', this.baseUrl);
  }

  /**
   * Request attestation envelope for a payment bundle
   */
  async requestAttestation(request: AttestationRequest): Promise<AttestationEnvelope> {
    console.log('[VerifierService] Requesting attestation for bundle:', request.bundleId);

    try {
      const response = await this.fetch('/api/attestation/request', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Attestation request failed: ${response.status}`);
      }

      const envelope = await response.json();
      console.log('[VerifierService] ✅ Received attestation envelope');

      return envelope;
    } catch (error) {
      console.error('[VerifierService] ❌ Attestation request failed:', error);
      throw error;
    }
  }

  /**
   * Verify an attestation signature
   */
  async verifyAttestation(request: VerifyAttestationRequest): Promise<VerifyAttestationResponse> {
    console.log('[VerifierService] Verifying attestation for bundle:', request.bundleId);

    try {
      const response = await this.fetch('/api/attestation/verify', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Attestation verification failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('[VerifierService] Verification result:', result.valid ? '✅ Valid' : '❌ Invalid');

      return result;
    } catch (error) {
      console.error('[VerifierService] ❌ Attestation verification failed:', error);
      throw error;
    }
  }

  /**
   * Report a fraudulent bundle
   */
  async reportFraud(request: ReportFraudRequest): Promise<{ success: boolean; message: string }> {
    console.log('[VerifierService] Reporting fraud for bundle:', request.bundleId);

    try {
      const response = await this.fetch('/api/attestation/report-fraud', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Fraud report failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('[VerifierService] ✅ Fraud reported successfully');

      return result;
    } catch (error) {
      console.error('[VerifierService] ❌ Fraud report failed:', error);
      throw error;
    }
  }

  /**
   * Get device reputation
   */
  async getReputation(deviceId: string): Promise<DeviceReputation> {
    console.log('[VerifierService] Fetching reputation for device:', deviceId.substring(0, 16) + '...');

    try {
      const response = await this.fetch(`/api/attestation/reputation/${deviceId}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Reputation fetch failed: ${response.status}`);
      }

      const reputation = await response.json();
      console.log('[VerifierService] Reputation score:', reputation.reputationScore);

      return reputation;
    } catch (error) {
      console.error('[VerifierService] ❌ Reputation fetch failed:', error);
      throw error;
    }
  }

  /**
   * Get all blacklisted devices
   */
  async getBlacklist(): Promise<DeviceReputation[]> {
    console.log('[VerifierService] Fetching blacklist');

    try {
      const response = await this.fetch('/api/attestation/blacklist', {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Blacklist fetch failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('[VerifierService] Blacklist size:', result.count);

      return result.devices;
    } catch (error) {
      console.error('[VerifierService] ❌ Blacklist fetch failed:', error);
      throw error;
    }
  }

  /**
   * Check verifier service health
   */
  async healthCheck(): Promise<{ status: string; devMode: boolean }> {
    try {
      const response = await this.fetch('/health', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const health = await response.json();
      console.log('[VerifierService] Health check:', health.status);

      return health;
    } catch (error) {
      console.error('[VerifierService] ❌ Health check failed:', error);
      throw error;
    }
  }

  /**
   * Internal fetch wrapper with timeout
   */
  private async fetch(endpoint: string, options: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Verifier service timeout after ${this.timeout}ms`);
      }

      throw error;
    }
  }
}

// Singleton instance
export const verifierService = new VerifierService();
