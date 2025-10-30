mod state;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_lang::solana_program::keccak;

mod attestation;
use crate::attestation::{SettlementEvidence, AttestationRole, verify_attestation};
use crate::state::{BundleRecord, FraudReason, NonceRegistry, MAX_BUNDLE_HISTORY, MAX_FRAUD_RECORDS};

const MAX_RECENT_HASHES: usize = 16;


declare_id!("6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi");

#[program]
pub mod beam {
    use super::*;

    /// Initialize escrow account for offline payments
    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, initial_amount: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_account;
        escrow.owner = ctx.accounts.owner.key();
        escrow.escrow_token_account = ctx.accounts.escrow_token_account.key();
        escrow.escrow_balance = 0;
        escrow.last_nonce = 0;
        escrow.reputation_score = 100;
        escrow.total_spent = 0;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.bump = ctx.bumps.escrow_account;
        // Phase 1.3: Initialize fraud detection fields
        escrow.stake_locked = 0;
        escrow.fraud_count = 0;
        escrow.last_fraud_timestamp = 0;

        // Transfer initial funds to escrow
        if initial_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.owner_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, initial_amount)?;

            escrow.escrow_balance = initial_amount;
        }

        emit!(EscrowInitialized {
            owner: escrow.owner,
            initial_balance: initial_amount,
        });

        Ok(())
    }

    /// Add funds to existing escrow
    pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
        require!(amount > 0, BeamError::InvalidAmount);

        let cpi_accounts = Transfer {
            from: ctx.accounts.owner_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.escrow_balance = escrow.escrow_balance.checked_add(amount)
            .ok_or(BeamError::Overflow)?;

        emit!(EscrowFunded {
            owner: escrow.owner,
            amount,
            new_balance: escrow.escrow_balance,
        });

        Ok(())
    }

    /// Settle offline payment (called when either party goes online)
    pub fn settle_offline_payment(
        ctx: Context<SettlePayment>,
        amount: u64,
        payer_nonce: u64,
        bundle_id: String,
        evidence: SettlementEvidence,
    ) -> Result<()> {
        require!(!bundle_id.is_empty() && bundle_id.len() <= 128, BeamError::InvalidBundleId);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let merchant_key = ctx.accounts.merchant.key();

        // Make attestation optional - validate only if provided
        // For online payments, attestation can be omitted (direct wallet signature verification)
        // For offline payments, client should provide hardware attestation
        if let Some(payer_proof) = evidence.payer_proof.as_ref() {
            require!(
                verify_attestation(
                    payer_proof,
                    AttestationRole::Payer,
                    &bundle_id,
                    &ctx.accounts.payer.key(),
                    &merchant_key,
                    amount,
                    payer_nonce,
                    now,
                ),
                BeamError::InvalidAttestation
            );
        }

        if let Some(merchant_proof) = evidence.merchant_proof.as_ref() {
            require!(
                verify_attestation(
                    merchant_proof,
                    AttestationRole::Merchant,
                    &bundle_id,
                    &ctx.accounts.payer.key(),
                    &merchant_key,
                    amount,
                    payer_nonce,
                    now,
                ),
                BeamError::InvalidAttestation
            );
        }

        let bundle_hash = keccak::hash(bundle_id.as_bytes()).to_bytes();
        require!(ctx.accounts.nonce_registry.owner == ctx.accounts.payer.key(), BeamError::InvalidOwner);
        require!(
            !ctx.accounts.nonce_registry.recent_bundle_hashes.iter().any(|h| *h == bundle_hash),
            BeamError::DuplicateBundle
        );

        // Verify nonce (prevent replay)
        require!(payer_nonce > ctx.accounts.nonce_registry.last_nonce, BeamError::InvalidNonce);
        require!(payer_nonce > ctx.accounts.escrow_account.last_nonce, BeamError::InvalidNonce);

        // Verify sufficient balance
        require!(ctx.accounts.escrow_account.escrow_balance >= amount, BeamError::InsufficientFunds);

        // Transfer from escrow to merchant
        let owner_key = ctx.accounts.escrow_account.owner;
        let bump = ctx.accounts.escrow_account.bump;
        let seeds = &[
            b"escrow",
            owner_key.as_ref(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.merchant_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        // Update escrow state
        let escrow = &mut ctx.accounts.escrow_account;
        escrow.escrow_balance = escrow.escrow_balance.checked_sub(amount)
            .ok_or(BeamError::Underflow)?;
        escrow.last_nonce = payer_nonce;
        escrow.total_spent = escrow.total_spent.checked_add(amount)
            .ok_or(BeamError::Overflow)?;
        ctx.accounts.nonce_registry.last_nonce = payer_nonce;

        // Track recent bundle hashes and history for dispute resolution
        let registry = &mut ctx.accounts.nonce_registry;
        let recent = &mut registry.recent_bundle_hashes;
        if recent.len() >= MAX_RECENT_HASHES {
            recent.remove(0);
        }
        recent.push(bundle_hash);

        let history = &mut registry.bundle_history;
        if history.len() >= MAX_BUNDLE_HISTORY {
            history.remove(0);
        }
        history.push(BundleRecord {
            bundle_hash,
            merchant: merchant_key,
            amount,
            settled_at: now,
            nonce: payer_nonce,
        });

        emit!(PaymentSettled {
            payer: owner_key,
            merchant: merchant_key,
            amount,
            nonce: payer_nonce,
            bundle_id,
        });

        emit!(BundleHistoryRecorded {
            payer: owner_key,
            merchant: merchant_key,
            bundle_hash,
            amount,
            nonce: payer_nonce,
            settled_at: now,
        });

        Ok(())
    }

    /// Initialize nonce registry for payer
    pub fn initialize_nonce_registry(ctx: Context<InitializeNonceRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.nonce_registry;
        registry.owner = ctx.accounts.payer.key();
        registry.last_nonce = 0;
        registry.bump = ctx.bumps.nonce_registry;
        Ok(())
    }

    /// Withdraw unused escrow funds
    pub fn withdraw_escrow(ctx: Context<WithdrawEscrow>, amount: u64) -> Result<()> {
        require!(amount > 0, BeamError::InvalidAmount);
        require!(ctx.accounts.escrow_account.escrow_balance >= amount, BeamError::InsufficientFunds);

        let owner_key = ctx.accounts.escrow_account.owner;
        let bump = ctx.accounts.escrow_account.bump;
        let seeds = &[
            b"escrow",
            owner_key.as_ref(),
            &[bump],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: ctx.accounts.escrow_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.escrow_balance = escrow.escrow_balance.checked_sub(amount)
            .ok_or(BeamError::Underflow)?;

        emit!(EscrowWithdrawn {
            owner: owner_key,
            amount,
            remaining_balance: escrow.escrow_balance,
        });

        Ok(())
    }

    /// Report conflicting bundle evidence to initiate a fraud dispute
    pub fn report_fraudulent_bundle(
        ctx: Context<ReportFraud>,
        bundle_id: String,
        conflicting_hash: [u8; 32],
        reason: FraudReason,
    ) -> Result<()> {
        require!(!bundle_id.is_empty() && bundle_id.len() <= 128, BeamError::InvalidBundleId);
        require!(conflicting_hash != [0u8; 32], BeamError::InvalidBundleHash);

        let registry = &mut ctx.accounts.nonce_registry;
        require_keys_eq!(registry.owner, ctx.accounts.payer.key(), BeamError::InvalidOwner);

        let bundle_hash = keccak::hash(bundle_id.as_bytes()).to_bytes();
        let has_record = registry
            .bundle_history
            .iter()
            .any(|record| record.bundle_hash == bundle_hash);
        require!(has_record, BeamError::BundleHistoryNotFound);
        require!(bundle_hash != conflicting_hash, BeamError::FraudHashMatches);

        let duplicate = registry
            .fraud_records
            .iter()
            .any(|record| record.bundle_hash == bundle_hash && record.conflicting_hash == conflicting_hash);
        require!(!duplicate, BeamError::FraudEvidenceExists);

        if registry.fraud_records.len() >= MAX_FRAUD_RECORDS {
            registry.fraud_records.remove(0);
        }

        let now = Clock::get()?.unix_timestamp;
        registry.fraud_records.push(crate::state::FraudRecord {
            bundle_hash,
            conflicting_hash,
            reporter: ctx.accounts.reporter.key(),
            reported_at: now,
            reason,
        });

        emit!(FraudEvidenceSubmitted {
            payer: registry.owner,
            reporter: ctx.accounts.reporter.key(),
            bundle_hash,
            conflicting_hash,
            reason,
            reported_at: now,
        });

        // Phase 1.3: Apply stake slashing for fraud
        let escrow = &mut ctx.accounts.escrow_account;

        // Find the fraudulent bundle to get amount
        let fraud_bundle = registry
            .bundle_history
            .iter()
            .find(|record| record.bundle_hash == bundle_hash)
            .ok_or(BeamError::BundleHistoryNotFound)?;

        // Slash 2x the payment amount
        let slash_amount = fraud_bundle.amount.checked_mul(2)
            .ok_or(BeamError::Overflow)?;

        // Ensure sufficient balance to slash
        require!(
            escrow.escrow_balance >= slash_amount,
            BeamError::InsufficientFundsForSlash
        );

        // Lock slashed funds (remove from escrow_balance, add to stake_locked)
        escrow.escrow_balance = escrow.escrow_balance.checked_sub(slash_amount)
            .ok_or(BeamError::Underflow)?;
        escrow.stake_locked = escrow.stake_locked.checked_add(slash_amount)
            .ok_or(BeamError::Overflow)?;

        // Update fraud tracking
        escrow.fraud_count = escrow.fraud_count.checked_add(1)
            .ok_or(BeamError::Overflow)?;
        escrow.last_fraud_timestamp = now;

        // Permanently reduce reputation score
        escrow.reputation_score = escrow.reputation_score.saturating_sub(1000);

        emit!(FraudPenaltyApplied {
            payer: escrow.owner,
            slashed_amount: slash_amount,
            new_reputation: escrow.reputation_score,
            fraud_count: escrow.fraud_count,
        });

        Ok(())
    }

    /// Migrate old escrow account (107 bytes) to new format (127 bytes)
    /// This is a one-time migration for accounts created before fraud fields were added
    pub fn migrate_escrow(ctx: Context<MigrateEscrow>) -> Result<()> {
        msg!("Migrating escrow account to new format with fraud fields");

        let escrow_info = &ctx.accounts.escrow_account;
        let owner = &ctx.accounts.owner;
        let system_program = &ctx.accounts.system_program;

        // Manually reallocate the account
        let current_size = escrow_info.data_len();
        let new_size = 8 + std::mem::size_of::<OfflineEscrowAccount>();

        msg!("Current size: {}, New size: {}", current_size, new_size);

        if current_size < new_size {
            // Reallocate to new size using realloc (size, zero_init)
            escrow_info.realloc(new_size, false)?;

            // Transfer lamports for rent exemption difference
            let rent = Rent::get()?;
            let old_rent = rent.minimum_balance(current_size);
            let new_rent = rent.minimum_balance(new_size);
            let lamports_diff = new_rent.saturating_sub(old_rent);

            if lamports_diff > 0 {
                msg!("Transferring {} lamports for rent", lamports_diff);
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: owner.to_account_info(),
                            to: escrow_info.to_account_info(),
                        },
                    ),
                    lamports_diff,
                )?;
            }

            // Zero out the new bytes (fraud fields at the end)
            let mut data = escrow_info.try_borrow_mut_data()?;
            let fraud_offset = current_size;
            data[fraud_offset..new_size].fill(0);

            msg!("✅ Account reallocated from {} to {} bytes", current_size, new_size);
            msg!("✅ Fraud fields initialized to 0");
        } else {
            msg!("⚠️  Account already at correct size, no migration needed");
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + OfflineEscrowAccount::INIT_SPACE,
        seeds = [b"escrow", owner.key().as_ref()],
        bump
    )]
    pub escrow_account: Account<'info, OfflineEscrowAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow_account.key() @ BeamError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", owner.key().as_ref()],
        bump = escrow_account.bump,
        has_one = owner
    )]
    pub escrow_account: Account<'info, OfflineEscrowAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow_account.key() @ BeamError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettlePayment<'info> {
    #[account(
        mut,
        seeds = [b"escrow", payer.key().as_ref()],
        bump = escrow_account.bump,
        has_one = owner @ BeamError::InvalidOwner
    )]
    pub escrow_account: Account<'info, OfflineEscrowAccount>,

    /// CHECK: Owner from escrow account
    pub owner: UncheckedAccount<'info>,

    /// CHECK: Payer who made offline payment
    pub payer: Signer<'info>,

    /// CHECK: Merchant receiving payment
    pub merchant: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow_account.key() @ BeamError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub merchant_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"nonce", payer.key().as_ref()],
        bump = nonce_registry.bump,
        has_one = owner @ BeamError::InvalidOwner
    )]
    pub nonce_registry: Account<'info, NonceRegistry>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeNonceRegistry<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        seeds = [b"nonce", payer.key().as_ref()],
        bump,
        space = 8 + NonceRegistry::INIT_SPACE
    )]
    pub nonce_registry: Account<'info, NonceRegistry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", owner.key().as_ref()],
        bump = escrow_account.bump,
        has_one = owner
    )]
    pub escrow_account: Account<'info, OfflineEscrowAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = escrow_token_account.owner == escrow_account.key() @ BeamError::InvalidEscrowTokenAccount
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReportFraud<'info> {
    #[account(
        mut,
        seeds = [b"nonce", payer.key().as_ref()],
        bump = nonce_registry.bump
    )]
    pub nonce_registry: Account<'info, NonceRegistry>,

    #[account(
        mut,
        seeds = [b"escrow", payer.key().as_ref()],
        bump = escrow_account.bump
    )]
    pub escrow_account: Account<'info, OfflineEscrowAccount>,

    /// CHECK: Verified against nonce registry owner
    pub payer: UncheckedAccount<'info>,

    pub reporter: Signer<'info>,
}

#[derive(Accounts)]
pub struct MigrateEscrow<'info> {
    /// CHECK: Manual validation and reallocation
    #[account(
        mut,
        seeds = [b"escrow", owner.key().as_ref()],
        bump,
    )]
    pub escrow_account: AccountInfo<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct OfflineEscrowAccount {
    pub owner: Pubkey,
    pub escrow_token_account: Pubkey,  // Store token account address
    pub escrow_balance: u64,
    pub last_nonce: u64,
    pub reputation_score: u16,
    pub total_spent: u64,
    pub created_at: i64,
    pub bump: u8,
    // Phase 1.3: Stake slashing fields
    pub stake_locked: u64,        // Funds locked as penalty for fraud
    pub fraud_count: u32,          // Number of detected fraud attempts
    pub last_fraud_timestamp: i64, // When last fraud was detected
}

#[event]
pub struct EscrowInitialized {
    pub owner: Pubkey,
    pub initial_balance: u64,
}

#[event]
pub struct EscrowFunded {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct PaymentSettled {
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub bundle_id: String,
}

#[event]
pub struct BundleHistoryRecorded {
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub bundle_hash: [u8; 32],
    pub amount: u64,
    pub nonce: u64,
    pub settled_at: i64,
}

#[event]
pub struct FraudEvidenceSubmitted {
    pub payer: Pubkey,
    pub reporter: Pubkey,
    pub bundle_hash: [u8; 32],
    pub conflicting_hash: [u8; 32],
    pub reason: FraudReason,
    pub reported_at: i64,
}

#[event]
pub struct EscrowWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub remaining_balance: u64,
}

#[event]
pub struct FraudPenaltyApplied {
    pub payer: Pubkey,
    pub slashed_amount: u64,
    pub new_reputation: u16,
    pub fraud_count: u32,
}

#[error_code]
pub enum BeamError {
    #[msg("Invalid amount specified")]
    InvalidAmount,
    #[msg("Insufficient funds in escrow")]
    InsufficientFunds,
    #[msg("Invalid nonce (must be > last_nonce)")]
    InvalidNonce,
    #[msg("Escrow token account owner must be the escrow PDA")]
    InvalidEscrowTokenAccount,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Attestation required")]
    MissingAttestation,
    #[msg("Invalid attestation provided")]
    InvalidAttestation,
    #[msg("Invalid bundle identifier")]
    InvalidBundleId,
    #[msg("Duplicate bundle detected")]
    DuplicateBundle,
    #[msg("Invalid bundle hash")]
    InvalidBundleHash,
    #[msg("Bundle history not found")]
    BundleHistoryNotFound,
    #[msg("Conflicting hash matches settled bundle")]
    FraudHashMatches,
    #[msg("Fraud evidence already exists")]
    FraudEvidenceExists,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
    #[msg("Insufficient funds for slash penalty")]
    InsufficientFundsForSlash,
}
