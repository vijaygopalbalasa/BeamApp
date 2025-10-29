import { NativeModules } from 'react-native';
import { Buffer } from 'buffer';
import type { AttestationEnvelope } from '@beam/shared';

const MODULE_NAME = 'SecureStorageBridge';

interface SignOptions {
  requireBiometrics?: boolean;
  reason?: string;
}

interface AttestationOptions {
  usePlayIntegrity?: boolean;
  endpoint?: string; // Optional override for verifier endpoint
}

export interface BundleMetadata {
  amount: number;
  currency: string;
  merchantPubkey: string;
  payerPubkey: string;
  nonce: number;
  createdAt: number;
  attestations?: {
    payer?: StoredAttestation;
    merchant?: StoredAttestation;
  };
}

export interface StoredBundle {
  bundleId: string;
  payload: string; // base64 encoded
  metadata?: BundleMetadata;
  payerAttestation?: AttestationEnvelope;
  merchantAttestation?: AttestationEnvelope;
}

export interface StoredAttestation {
  bundleId: string;
  timestamp: number;
  nonce: string;
  attestationReport: string;
  signature: string;
  certificateChain: string[];
  deviceInfo: AttestationEnvelope['deviceInfo'];
}

export interface SecureStorageModule {
  ensureWalletKeypair(): Promise<string>;
  signDetached(payload: string, options?: SignOptions): Promise<string>;
  storeTransaction(bundleId: string, payload: string, metadata: BundleMetadata): Promise<void>;
  loadTransactions(): Promise<StoredBundle[]>;
  removeTransaction(bundleId: string): Promise<void>;
  clearAll(): Promise<void>;
  fetchAttestation(bundleId: string, options?: AttestationOptions): Promise<AttestationEnvelope>;
  resetWallet(): Promise<void>;
  exportWallet(passphrase: string): Promise<string>;
  importWallet(passphrase: string, backup: string): Promise<string>;
}

const NativeBridge: SecureStorageModule | undefined = (NativeModules as unknown as {
  [MODULE_NAME]?: SecureStorageModule;
})[MODULE_NAME];

class UnimplementedSecureStorage implements SecureStorageModule {
  async ensureWalletKeypair(): Promise<string> {
    throw new Error('Secure storage bridge not implemented');
  }

  async signDetached(): Promise<string> {
    throw new Error('Secure storage bridge not implemented');
  }

  async storeTransaction(): Promise<void> {
    throw new Error('Secure storage bridge not implemented');
  }

  async loadTransactions(): Promise<StoredBundle[]> {
    return [];
  }

  async removeTransaction(): Promise<void> {
    throw new Error('Secure storage bridge not implemented');
  }

  async clearAll(): Promise<void> {
    throw new Error('Secure storage bridge not implemented');
  }

  async fetchAttestation(): Promise<AttestationEnvelope> {
    throw new Error('Secure storage bridge not implemented');
  }

  async resetWallet(): Promise<void> {
    throw new Error('Secure storage bridge not implemented');
  }

  async exportWallet(): Promise<string> {
    throw new Error('Secure storage bridge not implemented');
  }

  async importWallet(): Promise<string> {
    throw new Error('Secure storage bridge not implemented');
  }
}

export const SecureStorage = NativeBridge ?? new UnimplementedSecureStorage();

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

export function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(Buffer.from(data, 'base64'));
}
