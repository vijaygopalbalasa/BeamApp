/**
 * Play Integrity Service - Hardware Attestation
 *
 * Provides device attestation using Google Play Integrity API
 * or mock tokens for development/testing.
 */

import { NativeModules } from 'react-native';

interface PlayIntegrityModule {
  requestIntegrityToken(nonce: string): Promise<string>;
  getDeviceInfo(): Promise<DeviceInfo>;
  checkSecurityLevel(): Promise<SecurityLevelInfo>;
  getDeviceId(): Promise<string>;
  DEV_MODE: boolean;
  SUPPORTS_STRONGBOX: boolean;
  SUPPORTS_TEE: boolean;
  SDK_VERSION: number;
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

class PlayIntegrityService {
  private bridge: PlayIntegrityModule;

  constructor() {
    this.bridge = NativeModules.PlayIntegrityBridge;

    if (!this.bridge) {
      throw new Error('PlayIntegrityBridge native module not found');
    }

    console.log('[PlayIntegrityService] Initialized', {
      devMode: this.bridge.DEV_MODE,
      supportsStrongBox: this.bridge.SUPPORTS_STRONGBOX,
      supportsTEE: this.bridge.SUPPORTS_TEE,
      sdkVersion: this.bridge.SDK_VERSION,
    });
  }

  /**
   * Request Play Integrity attestation token
   * @param nonce - Random nonce to include in attestation
   * @returns JWT-formatted integrity token
   */
  async requestIntegrityToken(nonce: string): Promise<string> {
    console.log('[PlayIntegrityService] Requesting integrity token with nonce:', nonce.substring(0, 16) + '...');

    try {
      const token = await this.bridge.requestIntegrityToken(nonce);

      if (__DEV__) {
        console.log('[PlayIntegrityService] ✅ Received token:', token.substring(0, 100) + '...');
      }

      return token;
    } catch (error) {
      console.error('[PlayIntegrityService] ❌ Failed to request integrity token:', error);
      throw error;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    try {
      const deviceInfo = await this.bridge.getDeviceInfo();

      if (__DEV__) {
        console.log('[PlayIntegrityService] Device info:', {
          model: deviceInfo.model,
          osVersion: deviceInfo.osVersion,
          securityLevel: deviceInfo.securityLevel,
        });
      }

      return deviceInfo;
    } catch (error) {
      console.error('[PlayIntegrityService] ❌ Failed to get device info:', error);
      throw error;
    }
  }

  /**
   * Check device security level
   */
  async checkSecurityLevel(): Promise<SecurityLevelInfo> {
    try {
      const securityInfo = await this.bridge.checkSecurityLevel();

      console.log('[PlayIntegrityService] Security level:', securityInfo.securityLevel);

      if (!securityInfo.isSecure) {
        console.warn('[PlayIntegrityService] ⚠️ Device is not using hardware-backed security');
      }

      return securityInfo;
    } catch (error) {
      console.error('[PlayIntegrityService] ❌ Failed to check security level:', error);
      throw error;
    }
  }

  /**
   * Get unique device ID (SHA-256 of device fingerprint)
   */
  async getDeviceId(): Promise<string> {
    try {
      const deviceId = await this.bridge.getDeviceId();

      if (__DEV__) {
        console.log('[PlayIntegrityService] Device ID:', deviceId.substring(0, 16) + '...');
      }

      return deviceId;
    } catch (error) {
      console.error('[PlayIntegrityService] ❌ Failed to get device ID:', error);
      throw error;
    }
  }

  /**
   * Check if running in dev mode
   */
  isDevMode(): boolean {
    return this.bridge.DEV_MODE;
  }

  /**
   * Check if device supports StrongBox
   */
  supportsStrongBox(): boolean {
    return this.bridge.SUPPORTS_STRONGBOX;
  }

  /**
   * Check if device supports TEE
   */
  supportsTEE(): boolean {
    return this.bridge.SUPPORTS_TEE;
  }
}

// Singleton instance
export const playIntegrityService = new PlayIntegrityService();
