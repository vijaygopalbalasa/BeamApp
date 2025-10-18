import { PublicKey } from '@solana/web3.js';

/**
 * Escrow account data structure
 */
export interface EscrowAccount {
  address: PublicKey;
  owner: PublicKey;
  escrowTokenAccount: PublicKey;
  escrowBalance: number;
  lastNonce: number;
  reputationScore: number;
  totalSpent: number;
  createdAt: number;
  bump: number;
}

export type FraudReason = 'duplicateBundle' | 'invalidAttestation' | 'other';

export interface BundleHistoryEntry {
  bundleHash: string;
  merchant: PublicKey;
  amount: number;
  settledAt: number;
  nonce: number;
}

export interface FraudRecordEntry {
  bundleHash: string;
  conflictingHash: string;
  reporter: PublicKey;
  reportedAt: number;
  reason: FraudReason;
}

export interface NonceRegistryAccount {
  owner: PublicKey;
  lastNonce: number;
  bundleHistory: BundleHistoryEntry[];
  fraudRecords: FraudRecordEntry[];
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  connected: boolean;
  programExists: boolean;
  error?: string;
}
