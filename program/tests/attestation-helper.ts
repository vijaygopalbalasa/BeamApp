import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import * as ed25519 from "@noble/ed25519";

// Test verifier keypair - matches the public key in attestation.rs
const TEST_VERIFIER_PRIVATE_KEY = Uint8Array.from([68, 47, 157, 65, 96, 123, 192, 144, 45, 197, 182, 228, 89, 69, 251, 14, 34, 164, 241, 176, 249, 44, 209, 176, 9, 225, 121, 230, 54, 219, 135, 249]);
const TEST_VERIFIER_PUBLIC_KEY = Uint8Array.from([136, 45, 85, 209, 177, 250, 101, 107, 193, 219, 164, 39, 89, 87, 49, 133, 149, 126, 150, 141, 151, 47, 160, 235, 163, 194, 185, 187, 47, 202, 18, 74]);

export enum AttestationRole {
  Payer = 0,
  Merchant = 1,
}

export interface AttestationProof {
  attestationRoot: number[];
  attestationNonce: number[];
  attestationTimestamp: anchor.BN;
  verifierSignature: number[];
}

const ATTESTATION_PREFIX = Buffer.from("beam.attestation.v1");

export function computeAttestationRoot(
  role: AttestationRole,
  bundleId: string,
  payer: PublicKey,
  merchant: PublicKey,
  amount: number | anchor.BN,
  bundleNonce: number | anchor.BN,
  attestationNonce: Uint8Array,
  attestationTimestamp: number | anchor.BN
): Uint8Array {
  const amountBN = typeof amount === 'number' ? new anchor.BN(amount) : amount;
  const nonceBN = typeof bundleNonce === 'number' ? new anchor.BN(bundleNonce) : bundleNonce;
  const timestampBN = typeof attestationTimestamp === 'number' ? new anchor.BN(attestationTimestamp) : attestationTimestamp;

  const amountBytes = amountBN.toArrayLike(Buffer, 'le', 8);
  const nonceBytes = nonceBN.toArrayLike(Buffer, 'le', 8);
  const timestampBytes = timestampBN.toArrayLike(Buffer, 'le', 8);
  const roleBytes = Buffer.from([role]);

  // Concatenate all components for hashing (matching Solana's hashv)
  const components = Buffer.concat([
    ATTESTATION_PREFIX,
    Buffer.from(bundleId),
    payer.toBuffer(),
    merchant.toBuffer(),
    amountBytes,
    nonceBytes,
    roleBytes,
    Buffer.from(attestationNonce),
    timestampBytes,
  ]);

  // Use SHA256 to match Solana's hashv behavior
  return crypto.createHash('sha256').update(components).digest();
}

export async function createAttestationProof(
  role: AttestationRole,
  bundleId: string,
  payer: PublicKey,
  merchant: PublicKey,
  amount: number | anchor.BN,
  bundleNonce: number | anchor.BN,
  privateKey?: Uint8Array
): Promise<AttestationProof> {
  const attestationNonce = crypto.randomBytes(32);
  const attestationTimestamp = Math.floor(Date.now() / 1000);

  const attestationRoot = computeAttestationRoot(
    role,
    bundleId,
    payer,
    merchant,
    amount,
    bundleNonce,
    attestationNonce,
    attestationTimestamp
  );

  // Sign the attestation root with the test verifier private key
  const privKey = privateKey || TEST_VERIFIER_PRIVATE_KEY;
  const signature = await ed25519.signAsync(attestationRoot, privKey);

  return {
    attestationRoot: Array.from(attestationRoot),
    attestationNonce: Array.from(attestationNonce),
    attestationTimestamp: new anchor.BN(attestationTimestamp),
    verifierSignature: Array.from(signature),
  };
}

export function getTestVerifierPublicKey(): Uint8Array {
  return TEST_VERIFIER_PUBLIC_KEY;
}

export function getTestVerifierPrivateKey(): Uint8Array {
  return TEST_VERIFIER_PRIVATE_KEY;
}
