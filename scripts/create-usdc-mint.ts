#!/usr/bin/env ts-node
/**
 * Create Test USDC Token on Solana Devnet
 *
 * This script creates a new SPL token with USDC characteristics:
 * - 6 decimals (matching real USDC)
 * - Controlled mint authority for automated minting
 * - Freeze authority disabled for simplicity
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = 'devnet';
const DECIMALS = 6; // USDC has 6 decimals

async function main() {
  console.log('🚀 Creating Test USDC Token on Solana Devnet\n');

  // Connect to devnet
  const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');
  console.log(`✓ Connected to ${NETWORK}`);

  // Generate or load mint authority keypair
  const mintAuthorityPath = path.join(__dirname, 'usdc-mint-authority.json');
  let mintAuthority: Keypair;

  if (fs.existsSync(mintAuthorityPath)) {
    console.log('✓ Loading existing mint authority keypair');
    const keypairData = JSON.parse(fs.readFileSync(mintAuthorityPath, 'utf-8'));
    mintAuthority = Keypair.fromSecretKey(new Uint8Array(keypairData));
  } else {
    console.log('✓ Generating new mint authority keypair');
    mintAuthority = Keypair.generate();
    fs.writeFileSync(
      mintAuthorityPath,
      JSON.stringify(Array.from(mintAuthority.secretKey)),
      { mode: 0o600 } // Restrict permissions
    );
  }

  console.log(`✓ Mint Authority: ${mintAuthority.publicKey.toBase58()}`);

  // Check balance and request airdrop if needed
  const balance = await connection.getBalance(mintAuthority.publicKey);
  console.log(`  Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log('  Requesting airdrop...');
    try {
      const signature = await connection.requestAirdrop(
        mintAuthority.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature);
      console.log('  ✓ Airdrop successful');
    } catch (error) {
      console.error('  ⚠ Airdrop failed (rate limited). Please fund manually:');
      console.error(`    solana airdrop 2 ${mintAuthority.publicKey.toBase58()}`);
      process.exit(1);
    }
  }

  // Create the mint (token)
  console.log('\n📝 Creating SPL Token Mint...');
  const mint = await createMint(
    connection,
    mintAuthority, // Payer
    mintAuthority.publicKey, // Mint authority
    null, // Freeze authority (disabled)
    DECIMALS,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log(`✅ Token Created: ${mint.toBase58()}`);

  // Verify mint details
  const mintInfo = await getMint(connection, mint);
  console.log('\n📊 Token Details:');
  console.log(`  Mint Address: ${mint.toBase58()}`);
  console.log(`  Decimals: ${mintInfo.decimals}`);
  console.log(`  Supply: ${mintInfo.supply}`);
  console.log(`  Mint Authority: ${mintInfo.mintAuthority?.toBase58()}`);
  console.log(`  Freeze Authority: ${mintInfo.freezeAuthority?.toBase58() || 'disabled'}`);

  // Save configuration
  const configPath = path.join(__dirname, 'usdc-mint-config.json');
  const config = {
    network: NETWORK,
    mintAddress: mint.toBase58(),
    mintAuthority: mintAuthority.publicKey.toBase58(),
    decimals: DECIMALS,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n✓ Configuration saved to: ${configPath}`);

  console.log('\n✅ Setup Complete!');
  console.log('\n📋 Next Steps:');
  console.log('1. Update /Users/vijaygopalb/Beam/mobile/beam-app/src/config/index.ts');
  console.log(`   usdcMint: '${mint.toBase58()}'`);
  console.log('2. Use scripts/mint-usdc.ts to mint tokens to wallets');
  console.log('3. Secure the mint authority keypair appropriately');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
