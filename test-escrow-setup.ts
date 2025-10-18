// Test script to setup and fund escrow on devnet
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, mintTo, getMint } from '@solana/spl-token';
import * as bs58 from 'bs58';

const RPC_URL = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Your wallet private key (from .env)
const PRIVATE_KEY = 'Tu1Fa71gYstmpwQebe8aPVDqSeWheRt1eUW1T37EafK4Mrtzqgsfq1RxyFL6CoQ2tJ4a25Tmdwoe7nPgXcCp6bG';

async function main() {
  console.log('🚀 Beam Escrow Setup Test\n');

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, 'confirmed');
  const privateKeyBytes = bs58.decode(PRIVATE_KEY);
  const keypair = Keypair.fromSecretKey(privateKeyBytes);

  console.log('✅ Wallet:', keypair.publicKey.toBase58());

  // Check SOL balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 SOL Balance: ${balance / 1e9} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.log('⚠️  Low SOL balance! Get devnet SOL:');
    console.log(`   solana airdrop 2 ${keypair.publicKey.toBase58()} --url devnet\n`);
  }

  // Check/create USDC token account
  const userTokenAccount = await getAssociatedTokenAddress(USDC_MINT, keypair.publicKey);
  console.log('🪙 USDC Token Account:', userTokenAccount.toBase58());

  const tokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
  if (!tokenAccountInfo) {
    console.log('❌ USDC token account does not exist');
    console.log('   Creating token account...');
    const ix = createAssociatedTokenAccountInstruction(
      keypair.publicKey,
      userTokenAccount,
      keypair.publicKey,
      USDC_MINT
    );
    // Would need to send transaction here
    console.log('   ⚠️  Please create token account first\n');
    return;
  }

  console.log('✅ USDC token account exists\n');

  // Find escrow PDA
  const [escrowPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), keypair.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log('📦 Escrow PDA:', escrowPDA.toBase58());

  // Check if escrow exists
  const escrowInfo = await connection.getAccountInfo(escrowPDA);
  if (escrowInfo) {
    console.log('✅ Escrow account already exists!');
    console.log(`   Size: ${escrowInfo.data.length} bytes\n`);
  } else {
    console.log('❌ Escrow not initialized');
    console.log('   Run initialize_escrow from mobile app\n');
  }

  // Find nonce registry
  const [nonceRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('nonce'), keypair.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log('🔢 Nonce Registry:', nonceRegistry.toBase58());

  const nonceInfo = await connection.getAccountInfo(nonceRegistry);
  if (nonceInfo) {
    console.log('✅ Nonce registry exists\n');
  } else {
    console.log('❌ Nonce registry not initialized');
    console.log('   Will be created on first escrow init\n');
  }

  console.log('📋 Next Steps:');
  console.log('1. Open Beam app on Android');
  console.log('2. Go to Setup screen');
  console.log('3. Import wallet or create new one');
  console.log('4. Initialize escrow with 10 USDC');
  console.log('5. Test offline payment flow\n');

  console.log('🎯 Manual E2E Test Flow:');
  console.log('1. Device A (Merchant): Generate QR, enable mesh');
  console.log('2. Device B (Customer): Scan QR, create payment bundle');
  console.log('3. Device B: Signs bundle, stores locally');
  console.log('4. Device A: Receives bundle via mesh, countersigns');
  console.log('5. Device B: Goes online, settles payment');
  console.log('6. Verify on Solana Explorer\n');
}

main().catch(console.error);
