#!/usr/bin/env ts-node
/**
 * Mint Test USDC Tokens to User Wallets
 *
 * This script mints test USDC tokens to specified wallet addresses.
 * It can be run manually or integrated into an automated backend service.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = 'devnet';
const DEFAULT_MINT_AMOUNT = 100; // 100 USDC

interface MintConfig {
  network: string;
  mintAddress: string;
  mintAuthority: string;
  decimals: number;
}

async function loadConfig(): Promise<MintConfig> {
  const configPath = path.join(__dirname, 'usdc-mint-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      'Configuration not found. Please run create-usdc-mint.ts first.'
    );
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function loadMintAuthority(): Promise<Keypair> {
  const mintAuthorityPath = path.join(__dirname, 'usdc-mint-authority.json');
  if (!fs.existsSync(mintAuthorityPath)) {
    throw new Error(
      'Mint authority keypair not found. Please run create-usdc-mint.ts first.'
    );
  }
  const keypairData = JSON.parse(fs.readFileSync(mintAuthorityPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(keypairData));
}

async function mintUsdc(
  recipientAddress: string,
  amount: number = DEFAULT_MINT_AMOUNT
): Promise<string> {
  console.log('💰 Minting Test USDC Tokens\n');

  // Load configuration
  const config = await loadConfig();
  console.log(`✓ Network: ${config.network}`);
  console.log(`✓ Mint Address: ${config.mintAddress}`);

  // Connect to devnet
  const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

  // Load mint authority
  const mintAuthority = await loadMintAuthority();
  console.log(`✓ Mint Authority: ${mintAuthority.publicKey.toBase58()}`);

  // Parse recipient address
  const recipient = new PublicKey(recipientAddress);
  console.log(`✓ Recipient: ${recipient.toBase58()}`);

  // Parse mint address
  const mint = new PublicKey(config.mintAddress);

  // Get or create associated token account
  console.log('\n📝 Getting/Creating Token Account...');
  const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority, // Payer
    mint,
    recipient,
    false,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log(`✓ Token Account: ${recipientTokenAccount.address.toBase58()}`);

  // Mint tokens
  console.log(`\n💸 Minting ${amount} USDC...`);
  const amountWithDecimals = amount * Math.pow(10, config.decimals);
  const signature = await mintTo(
    connection,
    mintAuthority, // Payer
    mint,
    recipientTokenAccount.address,
    mintAuthority, // Mint authority
    amountWithDecimals,
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );

  console.log(`✅ Minting Successful!`);
  console.log(`  Transaction: ${signature}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`);

  return signature;
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: ts-node mint-usdc.ts <recipient-address> [amount]');
    console.log('Example: ts-node mint-usdc.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 100');
    process.exit(1);
  }

  const recipientAddress = args[0];
  const amount = args[1] ? parseFloat(args[1]) : DEFAULT_MINT_AMOUNT;

  try {
    await mintUsdc(recipientAddress, amount);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Export for use as a module
export { mintUsdc, loadConfig, loadMintAuthority };

// Run if called directly
if (require.main === module) {
  main();
}
