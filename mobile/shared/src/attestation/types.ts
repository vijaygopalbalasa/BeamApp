export interface DeviceInfo {
  manufacturer: string;
  model: string;
  osVersion: string;
  securityPatch: string;
  platform: 'android' | 'ios' | 'other';
}

export type AttestationType = 'KEY_ATTESTATION' | 'PLAY_INTEGRITY';

export interface AttestationEnvelope {
  bundleId: string;
  timestamp: number;
  nonce: Uint8Array;
  signature: Uint8Array;
  attestationReport: Uint8Array;
  certificateChain: Uint8Array[];
  deviceInfo: DeviceInfo;
  attestationType?: AttestationType;
}

export interface BundleAttestation {
  bundleHash: Uint8Array;
  envelope: AttestationEnvelope;
}

export type AttestationRole = 'payer' | 'merchant';

export interface AttestationProof {
  root: Uint8Array;
  nonce: Uint8Array;
  timestamp: number;
  signature: Uint8Array;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  deviceInfo?: DeviceInfo;
}

export interface AttestationValidator {
  validate(envelope: AttestationEnvelope, bundleHash: Uint8Array): Promise<VerificationResult>;
}
