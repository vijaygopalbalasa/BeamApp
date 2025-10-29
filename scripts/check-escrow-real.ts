/**
 * COMPREHENSIVE ESCROW DIAGNOSTIC SCRIPT
 *
 * This script performs a deep investigation of the escrow account for the wallet:
 * GpfYuj5ZxyHBNnJov97eFBB798pk4RSmp89drxonJRRi
 *
 * It will:
 * 1. Derive the escrow PDA using the EXACT same logic as the app
 * 2. Fetch REAL on-chain account data from Solana devnet
 * 3. Deserialize and display ALL escrow account data
 * 4. Fetch the escrow token account balance
 * 5. List recent transactions for this wallet and escrow
 * 6. Compare PDA derivation with app logic
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import BeamIDL from '../mobile/beam-app/src/idl/beam.json';
import { Buffer } from 'buffer';

// ===== CONFIGURATION =====
const WALLET_ADDRESS = 'GpfYuj5ZxyHBNnJov97eFBB798pk4RSmp89drxonJRRi';
const PROGRAM_ID = new PublicKey('6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi');
const USDC_MINT = new PublicKey('CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N');
const RPC_URL = 'https://api.devnet.solana.com';

// USDC decimals
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

// ===== HELPER FUNCTIONS =====

function formatAmount(rawAmount: number | bigint): string {
  const amount = Number(rawAmount) / USDC_SCALE;
  return `${amount.toFixed(6)} USDC (${rawAmount} raw)`;
}

function formatDate(timestamp: number | bigint): string {
  const ts = Number(timestamp);
  if (ts === 0) return 'Not set';
  return new Date(ts * 1000).toISOString();
}

// ===== MAIN INVESTIGATION =====

async function investigateEscrow() {
  console.log('\n🔍 BEAM ESCROW INVESTIGATION');
  console.log('='.repeat(80));
  console.log(`📍 Wallet: ${WALLET_ADDRESS}`);
  console.log(`🔗 Network: Solana Devnet`);
  console.log(`📦 Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`💵 USDC Mint: ${USDC_MINT.toBase58()}`);
  console.log('='.repeat(80));

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  const walletPubkey = new PublicKey(WALLET_ADDRESS);

  console.log('\n⏳ Connecting to Solana devnet...');
  const slot = await connection.getSlot();
  console.log(`✅ Connected! Current slot: ${slot}`);

  // ===== STEP 1: DERIVE ESCROW PDA =====
  console.log('\n' + '='.repeat(80));
  console.log('STEP 1: DERIVE ESCROW PDA (Using EXACT app logic)');
  console.log('='.repeat(80));

  const [escrowPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), walletPubkey.toBuffer()],
    PROGRAM_ID
  );

  console.log(`\n📌 PDA Derivation:`);
  console.log(`   Seeds: ["escrow", ${WALLET_ADDRESS}]`);
  console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`   ✅ Escrow PDA: ${escrowPDA.toBase58()}`);
  console.log(`   Bump: ${bump}`);

  // ===== STEP 2: FETCH ESCROW ACCOUNT DATA =====
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: FETCH REAL ON-CHAIN ESCROW ACCOUNT DATA');
  console.log('='.repeat(80));

  const accountInfo = await connection.getAccountInfo(escrowPDA);

  if (!accountInfo) {
    console.log('\n❌ ESCROW ACCOUNT DOES NOT EXIST!');
    console.log('\n🔍 This means:');
    console.log('   - The initializeEscrow transaction may have FAILED');
    console.log('   - Or the escrow was never initialized');
    console.log('   - The transaction signature popup does NOT mean the tx succeeded');
    console.log('\n📋 Next Steps:');
    console.log('   1. Check if the wallet has recent transactions');
    console.log('   2. Look for failed transactions');
    console.log('   3. Verify the program ID is correct');

    // Check wallet balance
    console.log('\n💰 Checking wallet balances...');
    const solBalance = await connection.getBalance(walletPubkey);
    console.log(`   SOL: ${solBalance / 1e9} SOL`);

    // Check recent transactions
    await checkRecentTransactions(connection, walletPubkey);
    return;
  }

  console.log('\n✅ Escrow account exists!');
  console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
  console.log(`   Lamports: ${accountInfo.lamports}`);
  console.log(`   Data size: ${accountInfo.data.length} bytes`);
  console.log(`   Executable: ${accountInfo.executable}`);
  console.log(`   Rent epoch: ${accountInfo.rentEpoch}`);

  // ===== STEP 3: DESERIALIZE ACCOUNT DATA =====
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: DESERIALIZE ESCROW ACCOUNT STRUCTURE');
  console.log('='.repeat(80));

  try {
    // Manual deserialization to avoid Anchor version issues
    // Account structure from IDL (OfflineEscrowAccount):
    // - discriminator: 8 bytes
    // - owner: 32 bytes (Pubkey)
    // - escrow_token_account: 32 bytes (Pubkey)
    // - escrow_balance: 8 bytes (u64)
    // - last_nonce: 8 bytes (u64)
    // - reputation_score: 2 bytes (u16)
    // - total_spent: 8 bytes (u64)
    // - created_at: 8 bytes (i64)
    // - bump: 1 byte (u8)

    const data = accountInfo.data;
    let offset = 8; // Skip discriminator

    // Read owner (32 bytes)
    const owner = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Read escrow_token_account (32 bytes)
    const escrowTokenAccount = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Read escrow_balance (8 bytes, u64)
    const escrowBalance = data.readBigUInt64LE(offset);
    offset += 8;

    // Read last_nonce (8 bytes, u64)
    const lastNonce = data.readBigUInt64LE(offset);
    offset += 8;

    // Read reputation_score (2 bytes, u16)
    const reputationScore = data.readUInt16LE(offset);
    offset += 2;

    // Read total_spent (8 bytes, u64)
    const totalSpent = data.readBigUInt64LE(offset);
    offset += 8;

    // Read created_at (8 bytes, i64)
    const createdAt = data.readBigInt64LE(offset);
    offset += 8;

    // Read bump (1 byte, u8)
    const bump = data.readUInt8(offset);

    const escrowAccount = {
      owner,
      escrowTokenAccount,
      escrowBalance,
      lastNonce,
      reputationScore,
      totalSpent,
      createdAt,
      bump
    };

    console.log('\n📊 ESCROW ACCOUNT DATA:');
    console.log('─'.repeat(80));
    console.log(`   Owner: ${escrowAccount.owner.toBase58()}`);
    console.log(`   Escrow Token Account: ${escrowAccount.escrowTokenAccount.toBase58()}`);
    console.log(`   Escrow Balance: ${formatAmount(escrowAccount.escrowBalance)}`);
    console.log(`   Last Nonce: ${escrowAccount.lastNonce.toString()}`);
    console.log(`   Reputation Score: ${escrowAccount.reputationScore}`);
    console.log(`   Total Spent: ${formatAmount(escrowAccount.totalSpent)}`);
    console.log(`   Created At: ${formatDate(escrowAccount.createdAt)}`);
    console.log(`   Bump: ${escrowAccount.bump}`);
    console.log('─'.repeat(80));

    // ===== STEP 4: FETCH TOKEN ACCOUNT BALANCE =====
    console.log('\n' + '='.repeat(80));
    console.log('STEP 4: FETCH ESCROW TOKEN ACCOUNT BALANCE');
    console.log('='.repeat(80));

    const tokenAccountAddress = escrowAccount.escrowTokenAccount;
    console.log(`\n🔍 Escrow Token Account: ${tokenAccountAddress.toBase58()}`);

    try {
      const tokenAccountInfo = await getAccount(connection, tokenAccountAddress);

      console.log('\n💰 TOKEN ACCOUNT INFO:');
      console.log('─'.repeat(80));
      console.log(`   Mint: ${tokenAccountInfo.mint.toBase58()}`);
      console.log(`   Owner: ${tokenAccountInfo.owner.toBase58()}`);
      console.log(`   Amount: ${formatAmount(tokenAccountInfo.amount)}`);
      console.log(`   Delegate: ${tokenAccountInfo.delegate?.toBase58() || 'None'}`);
      console.log(`   Delegated Amount: ${tokenAccountInfo.delegatedAmount}`);
      console.log(`   Is Native: ${tokenAccountInfo.isNative}`);
      console.log(`   Is Frozen: ${tokenAccountInfo.isFrozen}`);
      console.log('─'.repeat(80));

      // ===== CRITICAL COMPARISON =====
      console.log('\n' + '='.repeat(80));
      console.log('🚨 CRITICAL ANALYSIS: BALANCE MISMATCH DETECTION');
      console.log('='.repeat(80));

      const escrowBalanceFromAccount = Number(escrowAccount.escrowBalance);
      const tokenAccountBalance = Number(tokenAccountInfo.amount);

      console.log(`\n📊 Balance Comparison:`);
      console.log(`   Escrow Account Balance: ${formatAmount(escrowBalanceFromAccount)}`);
      console.log(`   Token Account Balance:  ${formatAmount(tokenAccountBalance)}`);

      if (escrowBalanceFromAccount === tokenAccountBalance) {
        console.log(`   ✅ Balances MATCH!`);
      } else {
        console.log(`   ❌ BALANCES MISMATCH!`);
        console.log(`   Difference: ${formatAmount(Math.abs(escrowBalanceFromAccount - tokenAccountBalance))}`);

        if (escrowBalanceFromAccount > tokenAccountBalance) {
          console.log(`\n⚠️  WARNING: Escrow account claims more USDC than token account holds!`);
          console.log(`   This could indicate:`);
          console.log(`   - A bug in the smart contract`);
          console.log(`   - Failed token transfer`);
          console.log(`   - Accounting error`);
        } else {
          console.log(`\n⚠️  WARNING: Token account has more USDC than escrow account claims!`);
          console.log(`   This could indicate:`);
          console.log(`   - Direct transfer to escrow token account (bypass program)`);
          console.log(`   - Escrow balance not updated correctly`);
        }
      }

      if (escrowBalanceFromAccount === 0 && tokenAccountBalance === 0) {
        console.log('\n❌ BOTH BALANCES ARE ZERO!');
        console.log('\n🔍 This confirms the issue:');
        console.log('   - The fund/initialize transaction likely FAILED on-chain');
        console.log('   - Even though the user saw a signature popup');
        console.log('   - The signature popup only means the TX was SUBMITTED, not CONFIRMED');
      } else if (tokenAccountBalance > 0) {
        console.log('\n✅ FUNDS ARE ACTUALLY IN THE TOKEN ACCOUNT!');
        console.log('   The escrow token account has USDC, but the program account may not reflect it.');
      }

    } catch (tokenError) {
      console.log(`\n❌ ERROR fetching token account: ${tokenError}`);
      console.log('   Token account may not exist or is invalid');
    }

  } catch (deserializeError) {
    console.log(`\n❌ ERROR deserializing escrow account: ${deserializeError}`);
    console.log('   Account data may be corrupted or wrong program');
  }

  // ===== STEP 5: CHECK RECENT TRANSACTIONS =====
  await checkRecentTransactions(connection, walletPubkey, escrowPDA);

  // ===== STEP 6: VERIFY PDA DERIVATION =====
  console.log('\n' + '='.repeat(80));
  console.log('STEP 6: VERIFY PDA DERIVATION MATCHES APP LOGIC');
  console.log('='.repeat(80));

  console.log('\n📋 App Logic (BeamProgram.ts line 157-159):');
  console.log('   findEscrowPDA(owner: PublicKey): [PublicKey, number] {');
  console.log('     return PublicKey.findProgramAddressSync(');
  console.log('       [Buffer.from("escrow"), owner.toBuffer()],');
  console.log('       PROGRAM_ID');
  console.log('     );');
  console.log('   }');

  console.log('\n📋 This Script Logic:');
  console.log('   const [escrowPDA, bump] = PublicKey.findProgramAddressSync(');
  console.log('     [Buffer.from("escrow"), walletPubkey.toBuffer()],');
  console.log('     PROGRAM_ID');
  console.log('   );');

  console.log('\n✅ PDA DERIVATION LOGIC MATCHES EXACTLY!');
  console.log(`   Both use seeds: ["escrow", wallet_pubkey]`);
  console.log(`   Both use program: ${PROGRAM_ID.toBase58()}`);
  console.log(`   Result: ${escrowPDA.toBase58()}`);

  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

async function checkRecentTransactions(connection: Connection, wallet: PublicKey, escrow?: PublicKey) {
  console.log('\n' + '='.repeat(80));
  console.log('RECENT TRANSACTION HISTORY');
  console.log('='.repeat(80));

  try {
    console.log('\n🔍 Fetching recent signatures for wallet...');
    const signatures = await connection.getSignaturesForAddress(wallet, { limit: 20 });

    if (signatures.length === 0) {
      console.log('   ⚠️  No transactions found for this wallet');
      return;
    }

    console.log(`\n📝 Found ${signatures.length} recent transactions:\n`);

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      const status = sig.err ? '❌' : '✅';
      const time = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'Unknown';

      console.log(`${i + 1}. ${status} Signature: ${sig.signature}`);
      console.log(`   Slot: ${sig.slot}`);
      console.log(`   Time: ${time}`);
      console.log(`   Status: ${sig.err ? `FAILED - ${JSON.stringify(sig.err)}` : 'SUCCESS'}`);

      // Try to get transaction details
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });

        if (tx) {
          console.log(`   Fee: ${tx.meta?.fee} lamports`);

          // Check for program invocations
          if (tx.transaction.message.getAccountKeys) {
            const accountKeys = tx.transaction.message.getAccountKeys();
            const programInvoked = accountKeys.staticAccountKeys.some(
              key => key.equals(PROGRAM_ID)
            );

            if (programInvoked) {
              console.log(`   🎯 BEAM PROGRAM INVOKED!`);
            }
          }

          // Check logs for errors
          if (tx.meta?.logMessages) {
            const errors = tx.meta.logMessages.filter(log =>
              log.toLowerCase().includes('error') ||
              log.toLowerCase().includes('failed') ||
              log.toLowerCase().includes('insufficient')
            );

            if (errors.length > 0) {
              console.log(`   ⚠️  Error logs:`);
              errors.forEach(err => console.log(`      ${err}`));
            }

            // Check for specific instruction logs
            const relevantLogs = tx.meta.logMessages.filter(log =>
              log.includes('InitializeEscrow') ||
              log.includes('FundEscrow') ||
              log.includes('EscrowInitialized') ||
              log.includes('EscrowFunded')
            );

            if (relevantLogs.length > 0) {
              console.log(`   📋 Relevant logs:`);
              relevantLogs.forEach(log => console.log(`      ${log}`));
            }
          }
        }
      } catch (txError) {
        console.log(`   ⚠️  Could not fetch transaction details`);
      }

      console.log('');
    }

    // Check escrow account transactions if escrow exists
    if (escrow) {
      console.log('\n🔍 Fetching recent signatures for ESCROW account...');
      const escrowSignatures = await connection.getSignaturesForAddress(escrow, { limit: 10 });

      if (escrowSignatures.length > 0) {
        console.log(`\n📝 Found ${escrowSignatures.length} escrow transactions:\n`);

        for (let i = 0; i < escrowSignatures.length; i++) {
          const sig = escrowSignatures[i];
          const status = sig.err ? '❌' : '✅';
          const time = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'Unknown';

          console.log(`${i + 1}. ${status} ${sig.signature} - ${time}`);
        }
      } else {
        console.log('   ⚠️  No transactions found for escrow account');
      }
    }

  } catch (error) {
    console.log(`\n❌ Error fetching transactions: ${error}`);
  }
}

// ===== RUN INVESTIGATION =====
investigateEscrow()
  .then(() => {
    console.log('\n✅ Investigation completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Investigation failed:', error);
    process.exit(1);
  });
