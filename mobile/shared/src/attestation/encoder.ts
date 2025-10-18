import { sha256 } from '@noble/hashes/sha256';
import { AttestationEnvelope } from './types';

function canonicalize(envelope: AttestationEnvelope): Record<string, unknown> {
  return {
    bundleId: envelope.bundleId,
    timestamp: envelope.timestamp,
    nonce: Array.from(envelope.nonce),
    signature: Array.from(envelope.signature),
    attestationReport: Array.from(envelope.attestationReport),
    certificateChain: envelope.certificateChain.map(cert => Array.from(cert)),
    deviceInfo: {
      manufacturer: envelope.deviceInfo.manufacturer,
      model: envelope.deviceInfo.model,
      osVersion: envelope.deviceInfo.osVersion,
      securityPatch: envelope.deviceInfo.securityPatch,
      platform: envelope.deviceInfo.platform,
    },
  };
}

export function encodeEnvelope(envelope: AttestationEnvelope): Uint8Array {
  const canonical = canonicalize(envelope);
  const json = JSON.stringify(canonical);
  return new TextEncoder().encode(json);
}

export function hashEnvelope(envelope: AttestationEnvelope): Uint8Array {
  const encoded = encodeEnvelope(envelope);
  return sha256(encoded);
}
