import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import type { OfflineBundle } from './types';

/**
 * Create canonical serialization of bundle for signing
 */
export function serializeBundle(bundle: Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'>): Uint8Array {
  const data = {
    tx_id: bundle.tx_id,
    escrow_pda: bundle.escrow_pda,
    token: bundle.token,
    payer_pubkey: bundle.payer_pubkey,
    merchant_pubkey: bundle.merchant_pubkey,
    nonce: bundle.nonce,
    timestamp: bundle.timestamp,
    version: bundle.version,
  };

  const json = JSON.stringify(data, Object.keys(data).sort());
  return new TextEncoder().encode(json);
}

/**
 * Sign bundle with ed25519 private key
 */
export function signBundle(bundle: Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'>, privateKey: Uint8Array): Uint8Array {
  const message = serializeBundle(bundle);
  const messageHash = sha256(message);
  return ed25519.sign(messageHash, privateKey);
}

/**
 * Verify bundle signature
 */
export function verifyBundleSignature(
  bundle: Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'>,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  const message = serializeBundle(bundle);
  const messageHash = sha256(message);
  return ed25519.verify(signature, messageHash, publicKey);
}

/**
 * Create unsigned payment bundle payload (no signatures)
 */
export function createUnsignedBundle(
  escrowPDA: string,
  payerPubkey: string,
  merchantPubkey: string,
  amount: number,
  tokenMint: string,
  tokenDecimals: number,
  nonce: number
): Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'> {
  return {
    tx_id: generateTxId(),
    escrow_pda: escrowPDA,
    token: {
      symbol: 'USDC',
      mint: tokenMint,
      decimals: tokenDecimals,
      amount,
    },
    payer_pubkey: payerPubkey,
    merchant_pubkey: merchantPubkey,
    nonce,
    timestamp: Date.now(),
    version: 1,
  };
}

/**
 * Create offline payment bundle (payer signs first)
 */
export function createOfflineBundle(
  escrowPDA: string,
  payerPubkey: string,
  merchantPubkey: string,
  amount: number,
  tokenMint: string,
  tokenDecimals: number,
  nonce: number,
  payerPrivateKey: Uint8Array
): OfflineBundle {
  const bundle = createUnsignedBundle(
    escrowPDA,
    payerPubkey,
    merchantPubkey,
    amount,
    tokenMint,
    tokenDecimals,
    nonce
  );

  const payerSignature = signBundle(bundle, payerPrivateKey);

  return {
    ...bundle,
    payer_signature: payerSignature,
  };
}

/**
 * Merchant signs the bundle to acknowledge receipt
 */
export function merchantSignBundle(
  bundle: OfflineBundle,
  merchantPrivateKey: Uint8Array
): OfflineBundle {
  const bundleData = unsignedFromBundle(bundle);
  const merchantSignature = signBundle(bundleData, merchantPrivateKey);

  return {
    ...bundle,
    merchant_signature: merchantSignature,
  };
}

/**
 * Verify both signatures on a completed bundle
 */
export function verifyCompletedBundle(
  bundle: OfflineBundle,
  payerPubkey: Uint8Array,
  merchantPubkey: Uint8Array
): { payerValid: boolean; merchantValid: boolean } {
  const bundleData = unsignedFromBundle(bundle);

  return {
    payerValid: bundle.payer_signature
      ? verifyBundleSignature(bundleData, bundle.payer_signature, payerPubkey)
      : false,
    merchantValid: bundle.merchant_signature
      ? verifyBundleSignature(bundleData, bundle.merchant_signature, merchantPubkey)
      : false,
  };
}

function generateTxId(): string {
  return `beam_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function unsignedFromBundle(bundle: OfflineBundle): Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'> {
  return {
    tx_id: bundle.tx_id,
    escrow_pda: bundle.escrow_pda,
    token: bundle.token,
    payer_pubkey: bundle.payer_pubkey,
    merchant_pubkey: bundle.merchant_pubkey,
    nonce: bundle.nonce,
    timestamp: bundle.timestamp,
    version: bundle.version,
  };
}

/**
 * Compute keccak256 hash of canonical unsigned bundle payload
 */
export function computeBundleHash(bundle: OfflineBundle): Uint8Array {
  const unsigned = unsignedFromBundle(bundle);
  const serialized = serializeBundle(unsigned);
  return keccak_256(serialized);
}

/**
 * Compute keccak256 hash used on-chain for bundle identifiers
 */
export function hashBundleId(bundleId: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(bundleId));
}
