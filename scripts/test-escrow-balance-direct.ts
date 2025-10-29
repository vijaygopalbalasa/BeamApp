/**
 * Direct test of escrow balance fetching using the same logic as the app
 */
import { Connection, PublicKey } from '@solana/web3.js';

const WALLET_ADDRESS = 'GpfYuj5ZxyHBNnJov97eFBB798pk4RSmp89drxonJRRi';
const PROGRAM_ID = new PublicKey('6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi');
const RPC_URL = 'https://api.devnet.solana.com';

async function testEscrowBalance() {
  console.log('\n=== TESTING ESCROW BALANCE (APP LOGIC) ===\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const walletPubkey = new PublicKey(WALLET_ADDRESS);

  // Derive escrow PDA (same as app)
  const [escrowPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), walletPubkey.toBuffer()],
    PROGRAM_ID
  );

  console.log('Wallet:', WALLET_ADDRESS);
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Escrow PDA:', escrowPDA.toBase58());
  console.log('');

  // Fetch account (same as app)
  const accountInfo = await connection.getAccountInfo(escrowPDA);

  if (!accountInfo) {
    console.log('❌ Escrow account does not exist');
    return;
  }

  console.log('✅ Escrow account exists');
  console.log('Data length:', accountInfo.data.length, 'bytes');
  console.log('');

  // Deserialize (EXACT same logic as BeamProgram.ts lines 185-216)
  const data = accountInfo.data;

  if (data.length < 8) {
    console.log('❌ Account data too short');
    return;
  }

  let offset = 8; // Skip 8-byte discriminator

  // owner: Pubkey (32 bytes)
  const ownerPubkey = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // escrow_token_account: Pubkey (32 bytes)
  const escrowTokenAccount = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // escrow_balance: u64 (8 bytes)
  const escrowBalance = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // last_nonce: u64 (8 bytes)
  const lastNonce = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // reputation_score: u16 (2 bytes)
  const reputationScore = data.readUInt16LE(offset);
  offset += 2;

  // total_spent: u64 (8 bytes)
  const totalSpent = Number(data.readBigUInt64LE(offset));
  offset += 8;

  // created_at: i64 (8 bytes)
  const createdAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  // bump: u8 (1 byte)
  const bump = data.readUInt8(offset);

  console.log('=== DESERIALIZED ESCROW ACCOUNT ===');
  console.log('Owner:', ownerPubkey.toBase58());
  console.log('Escrow Token Account:', escrowTokenAccount.toBase58());
  console.log('Escrow Balance (raw):', escrowBalance);
  console.log('Escrow Balance (USDC):', (escrowBalance / 1_000_000).toFixed(6));
  console.log('Last Nonce:', lastNonce);
  console.log('Reputation Score:', reputationScore);
  console.log('Total Spent (raw):', totalSpent);
  console.log('Total Spent (USDC):', (totalSpent / 1_000_000).toFixed(6));
  console.log('Created At:', new Date(createdAt * 1000).toISOString());
  console.log('Bump:', bump);
  console.log('');

  // Test the division that's used in UI
  console.log('=== UI DISPLAY TEST ===');
  console.log(`UI would show: $${(escrowBalance / 1_000_000).toFixed(2)} USDC`);
  console.log('');

  if (escrowBalance === 10000000) {
    console.log('✅ SUCCESS: Balance is exactly 10 USDC (10000000 raw)');
  } else if (escrowBalance === 0) {
    console.log('❌ PROBLEM: Balance is 0 - deserialization may be wrong');
  } else {
    console.log(`⚠️  Balance is ${escrowBalance / 1_000_000} USDC (${escrowBalance} raw)`);
  }
}

testEscrowBalance()
  .then(() => {
    console.log('\n✅ Test completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
