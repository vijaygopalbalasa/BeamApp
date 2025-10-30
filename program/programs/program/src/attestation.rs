use anchor_lang::prelude::*;
use ed25519_dalek::{PublicKey, Signature, Verifier};
use sha2::{Digest, Sha256};

const ATTESTATION_PREFIX: &[u8] = b"beam.attestation.v1";
// Verifier service public key - signs attestation envelopes
// Generated: 2025-01-27
// Private key stored in verifier service .env (VERIFIER_SIGNING_KEY)
const VERIFIER_PUBKEY_BYTES: [u8; 32] = [
    87, 206, 238, 248, 74, 20, 230, 164, 179, 203, 197, 110, 238, 157, 193, 117, 227, 137, 50, 120, 126, 101, 72, 203, 104, 54, 224, 253, 192, 80, 235, 17
];
const MAX_ATTESTATION_AGE: i64 = 86_400; // 24 hours

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AttestationRole {
    Payer,
    Merchant,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AttestationProof {
    pub attestation_root: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub attestation_timestamp: i64,
    pub verifier_signature: [u8; 64],
}

impl Default for AttestationProof {
    fn default() -> Self {
        Self {
            attestation_root: [0u8; 32],
            attestation_nonce: [0u8; 32],
            attestation_timestamp: 0,
            verifier_signature: [0u8; 64],
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SettlementEvidence {
    pub payer_proof: Option<AttestationProof>,
    pub merchant_proof: Option<AttestationProof>,
}

pub fn verify_attestation(
    proof: &AttestationProof,
    role: AttestationRole,
    bundle_id: &str,
    payer: &Pubkey,
    merchant: &Pubkey,
    amount: u64,
    bundle_nonce: u64,
    now: i64,
) -> bool {
    if proof.attestation_timestamp <= 0 || (now - proof.attestation_timestamp).abs() > MAX_ATTESTATION_AGE {
        return false;
    }

    let expected_root = compute_attestation_root(
        role,
        bundle_id,
        payer,
        merchant,
        amount,
        bundle_nonce,
        &proof.attestation_nonce,
        proof.attestation_timestamp,
    );

    if proof.attestation_root != expected_root {
        return false;
    }

    let signature = match Signature::from_bytes(&proof.verifier_signature) {
        Ok(sig) => sig,
        Err(_) => return false,
    };

    let verifying_key = match PublicKey::from_bytes(&VERIFIER_PUBKEY_BYTES) {
        Ok(key) => key,
        Err(_) => return false,
    };

    verifying_key
        .verify(expected_root.as_ref(), &signature)
        .is_ok()
}

pub fn compute_attestation_root(
    role: AttestationRole,
    bundle_id: &str,
    payer: &Pubkey,
    merchant: &Pubkey,
    amount: u64,
    bundle_nonce: u64,
    attestation_nonce: &[u8; 32],
    attestation_timestamp: i64,
) -> [u8; 32] {
    let amount_bytes = amount.to_le_bytes();
    let nonce_bytes = bundle_nonce.to_le_bytes();
    let timestamp_bytes = attestation_timestamp.to_le_bytes();
    let role_byte: [u8; 1] = match role {
        AttestationRole::Payer => [0u8],
        AttestationRole::Merchant => [1u8],
    };

    // Use SHA256 for attestation root computation (matches verifier and tests)
    let mut hasher = Sha256::new();
    hasher.update(ATTESTATION_PREFIX);
    hasher.update(bundle_id.as_bytes());
    hasher.update(payer.as_ref());
    hasher.update(merchant.as_ref());
    hasher.update(&amount_bytes);
    hasher.update(&nonce_bytes);
    hasher.update(&role_byte);
    hasher.update(attestation_nonce);
    hasher.update(&timestamp_bytes);

    let hash_result = hasher.finalize();
    let mut hash_bytes = [0u8; 32];
    hash_bytes.copy_from_slice(&hash_result);
    hash_bytes
}
