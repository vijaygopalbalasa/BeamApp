import { sha256 } from '@noble/hashes/sha256';
import { AttestationRole } from './types';

export interface AttestationRootInput {
  role: AttestationRole;
  bundleId: string;
  payer: Uint8Array;
  merchant: Uint8Array;
  amount: bigint | number;
  bundleNonce: bigint | number;
  attestationNonce: Uint8Array;
  attestationTimestamp: bigint | number;
}

const PREFIX = new TextEncoder().encode('beam.attestation.v1');

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function toLittleEndianBytes(value: bigint | number, byteLength: number): Uint8Array {
  const bigIntValue = BigInt(value);
  const result = new Uint8Array(byteLength);
  let temp = bigIntValue;
  for (let i = 0; i < byteLength; i++) {
    result[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return result;
}

export function computeAttestationRoot(input: AttestationRootInput): Uint8Array {
  if (input.attestationNonce.length !== 32) {
    throw new Error('Attestation nonce must be 32 bytes');
  }

  if (input.payer.length !== 32 || input.merchant.length !== 32) {
    throw new Error('Payer and merchant keys must be 32 bytes');
  }

  const roleByte = new Uint8Array([input.role === 'merchant' ? 1 : 0]);
  const bundleIdBytes = new TextEncoder().encode(input.bundleId);
  const amountBytes = toLittleEndianBytes(input.amount, 8);
  const bundleNonceBytes = toLittleEndianBytes(input.bundleNonce, 8);
  const timestampBytes = toLittleEndianBytes(input.attestationTimestamp, 8);

  const preimage = concatBytes(
    PREFIX,
    bundleIdBytes,
    input.payer,
    input.merchant,
    amountBytes,
    bundleNonceBytes,
    roleByte,
    input.attestationNonce,
    timestampBytes,
  );

  return sha256(preimage);
}
