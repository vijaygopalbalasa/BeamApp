use anchor_lang::prelude::*;

pub const MAX_BUNDLE_HISTORY: usize = 32;
pub const MAX_FRAUD_RECORDS: usize = 16;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub struct BundleRecord {
    pub bundle_hash: [u8; 32],
    pub merchant: Pubkey,
    pub amount: u64,
    pub settled_at: i64,
    pub nonce: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum FraudReason {
    DuplicateBundle,
    InvalidAttestation,
    Other,
}

impl Default for FraudReason {
    fn default() -> Self {
        FraudReason::Other
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Default)]
pub struct FraudRecord {
    pub bundle_hash: [u8; 32],
    pub conflicting_hash: [u8; 32],
    pub reporter: Pubkey,
    pub reported_at: i64,
    pub reason: FraudReason,
}

#[account]
#[derive(InitSpace)]
pub struct NonceRegistry {
    pub owner: Pubkey,
    pub last_nonce: u64,
    #[max_len(16)]
    pub recent_bundle_hashes: Vec<[u8; 32]>,
    #[max_len(MAX_BUNDLE_HISTORY)]
    pub bundle_history: Vec<BundleRecord>,
    #[max_len(MAX_FRAUD_RECORDS)]
    pub fraud_records: Vec<FraudRecord>,
    pub bump: u8,
}
