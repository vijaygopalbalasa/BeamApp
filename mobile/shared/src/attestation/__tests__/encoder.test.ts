import { describe, expect, it } from 'vitest';
import { encodeEnvelope, hashEnvelope } from '../encoder';
import type { AttestationEnvelope } from '../types';

function sampleEnvelope(): AttestationEnvelope {
  return {
    bundleId: 'bundle-123',
    timestamp: Date.now(),
    nonce: new Uint8Array(32).fill(1),
    signature: new Uint8Array([1, 2, 3]),
    attestationReport: new Uint8Array([4, 5, 6]),
    certificateChain: [new Uint8Array([7, 8, 9])],
    deviceInfo: {
      manufacturer: 'Test',
      model: 'Model',
      osVersion: '1.0',
      securityPatch: '2025-01-01',
      platform: 'android',
    },
  };
}

describe('attestation encoder', () => {
  it('encodes envelope deterministically', () => {
    const envelope = sampleEnvelope();
    const encoded1 = encodeEnvelope(envelope);
    const encoded2 = encodeEnvelope({ ...envelope });

    expect(encoded1).toEqual(encoded2);
  });

  it('produces hash output', () => {
    const envelope = sampleEnvelope();
    const hash = hashEnvelope(envelope);
    expect(hash.length).toBeGreaterThan(0);
  });
});
