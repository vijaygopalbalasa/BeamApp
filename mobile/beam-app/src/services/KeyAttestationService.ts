/**
 * Hardware Key Attestation Service
 *
 * Provides device attestation using Android Hardware Key Attestation
 * (no Google Play Services dependency - works on all Android devices).
 *
 * Replaces Play Integrity API with more censorship-resistant approach.
 */

import { NativeModules, Platform } from 'react-native';
import { Buffer } from 'buffer';

interface SecureStorageBridge {
  getKeyAttestationCertificates(challenge: string): Promise<{
    certificateChain: string[]; // Base64-encoded X.509 DER certificates
    securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE' | 'UNKNOWN';
    keyAlias: string;
    chainLength: number;
  }>;
}

export interface DeviceInfo {
  model: string;
  osVersion: string;
  securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  manufacturer: string;
  device: string;
  fingerprint: string;
  sdkVersion: number;
}

export interface SecurityLevelInfo {
  securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  isSecure: boolean;
  supportsStrongBox: boolean;
  supportsTEE: boolean;
}

export interface AttestationCertificates {
  certificateChain: string[]; // Base64-encoded X.509 DER certificates
  securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE' | 'UNKNOWN';
  challenge: string; // The challenge that was attested
}

class KeyAttestationService {
  private bridge: SecureStorageBridge;

  constructor() {
    this.bridge = NativeModules.SecureStorageBridge;

    if (!this.bridge) {
      throw new Error('SecureStorageBridge native module not found');
    }

    console.log('[KeyAttestationService] Initialized - Using hardware key attestation (no Google Play Services)');
  }

  /**
   * Request hardware key attestation with challenge
   * @param challenge - Random nonce/challenge to include in attestation (base64)
   * @returns Certificate chain with attestation extension
   */
  async requestAttestation(challenge: string): Promise<AttestationCertificates> {
    console.log('[KeyAttestationService] Requesting key attestation with challenge:', challenge.substring(0, 16) + '...');

    try {
      if (Platform.OS !== 'android') {
        throw new Error('Key attestation is only supported on Android');
      }

      const result = await this.bridge.getKeyAttestationCertificates(challenge);

      console.log('[KeyAttestationService] ✅ Received attestation certificate chain:', {
        chainLength: result.chainLength,
        securityLevel: result.securityLevel,
      });

      return {
        certificateChain: result.certificateChain,
        securityLevel: result.securityLevel,
        challenge,
      };
    } catch (error) {
      console.error('[KeyAttestationService] ❌ Failed to request key attestation:', error);
      throw error;
    }
  }

  /**
   * Generate random challenge for attestation
   * @returns Base64-encoded 32-byte challenge
   */
  generateChallenge(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('base64');
  }

  /**
   * Get device information (Android Build properties)
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    try {
      // Platform.constants provides device info in React Native
      const { Build } = Platform.constants || {};

      const deviceInfo: DeviceInfo = {
        model: Build?.MODEL || 'Unknown',
        osVersion: Build?.VERSION?.RELEASE || Platform.Version?.toString() || 'unknown',
        manufacturer: Build?.MANUFACTURER || 'Unknown',
        device: Build?.DEVICE || 'unknown',
        fingerprint: Build?.FINGERPRINT || 'unknown',
        sdkVersion: Build?.VERSION?.SDK_INT || 0,
        securityLevel: 'SOFTWARE', // Will be determined during attestation
      };

      console.log('[KeyAttestationService] Device info:', {
        model: deviceInfo.model,
        osVersion: deviceInfo.osVersion,
        sdkVersion: deviceInfo.sdkVersion,
      });

      return deviceInfo;
    } catch (error) {
      console.error('[KeyAttestationService] ❌ Failed to get device info:', error);
      throw error;
    }
  }

  /**
   * Check device security level by attempting attestation
   */
  async checkSecurityLevel(): Promise<SecurityLevelInfo> {
    try {
      // Attempt to generate attestation to determine security level
      const challenge = this.generateChallenge();
      const attestation = await this.requestAttestation(challenge);

      const securityInfo: SecurityLevelInfo = {
        securityLevel: attestation.securityLevel === 'UNKNOWN' ? 'SOFTWARE' : attestation.securityLevel,
        isSecure: attestation.securityLevel === 'STRONGBOX' || attestation.securityLevel === 'TEE',
        supportsStrongBox: attestation.securityLevel === 'STRONGBOX',
        supportsTEE: attestation.securityLevel === 'TEE' || attestation.securityLevel === 'STRONGBOX',
      };

      console.log('[KeyAttestationService] Security level:', securityInfo.securityLevel);

      if (!securityInfo.isSecure) {
        console.warn('[KeyAttestationService] ⚠️ Device is not using hardware-backed security');
      }

      return securityInfo;
    } catch (error) {
      console.error('[KeyAttestationService] ❌ Failed to check security level:', error);

      // Fallback to software level if attestation fails
      return {
        securityLevel: 'SOFTWARE',
        isSecure: false,
        supportsStrongBox: false,
        supportsTEE: false,
      };
    }
  }

  /**
   * Get unique device ID (SHA-256 of device fingerprint)
   */
  async getDeviceId(): Promise<string> {
    try {
      const deviceInfo = await this.getDeviceInfo();

      // Create device ID from fingerprint
      const fingerprint = deviceInfo.fingerprint;
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprint);

      // Use Web Crypto API for SHA-256
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const deviceId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      console.log('[KeyAttestationService] Device ID:', deviceId.substring(0, 16) + '...');

      return deviceId;
    } catch (error) {
      console.error('[KeyAttestationService] ❌ Failed to get device ID:', error);
      throw error;
    }
  }

  /**
   * Check if device supports StrongBox Keymaster
   */
  supportsStrongBox(): boolean {
    // StrongBox requires Android 9+ (API 28)
    const { Build } = Platform.constants || {};
    const sdkVersion = Build?.VERSION?.SDK_INT || 0;
    return sdkVersion >= 28;
  }

  /**
   * Check if device supports TEE (Trusted Execution Environment)
   */
  supportsTEE(): boolean {
    // TEE support starts from Android 7.0 (API 24) with key attestation
    const { Build } = Platform.constants || {};
    const sdkVersion = Build?.VERSION?.SDK_INT || 0;
    return sdkVersion >= 24;
  }

  /**
   * Check if running in dev mode (no longer applicable with key attestation)
   * Kept for API compatibility
   */
  isDevMode(): boolean {
    return __DEV__;
  }
}

// Singleton instance
export const keyAttestationService = new KeyAttestationService();
