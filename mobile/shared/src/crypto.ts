import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

export function canonicalSerialize(obj: any): Uint8Array {
  // Sort keys for deterministic serialization
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return new TextEncoder().encode(sorted);
}

export async function signBundle(bundleBytes: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const hash = sha256(bundleBytes);
  return ed.sign(hash, privateKey);
}

export async function verifyBundleSignature(
  bundleBytes: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  const hash = sha256(bundleBytes);
  return ed.verify(signature, hash, publicKey);
}
