import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const arr of arrays) {
    output.set(arr, offset);
    offset += arr.length;
  }
  return output;
}

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => sha512(concatBytes(...messages));

function parseHex(input: string): Uint8Array | null {
  const normalized = input.startsWith('0x') ? input.slice(2) : input;
  if (normalized.length !== 64) {
    return null;
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

function parseBase64(input: string): Uint8Array | null {
  try {
    return Uint8Array.from(Buffer.from(input, 'base64'));
  } catch (_err) {
    return null;
  }
}

export function parseSigningKey(raw?: string): Uint8Array | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return parseHex(trimmed) ?? parseBase64(trimmed);
}

export function derivePublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export async function signMessage(privateKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  return ed25519.sign(message, privateKey);
}
