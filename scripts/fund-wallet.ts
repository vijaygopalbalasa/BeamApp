#!/usr/bin/env ts-node
/**
 * Fund Wallet with SOL and USDC
 *
 * This script sends both SOL and USDC to a wallet address
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { mintUsdc, loadMintAuthority } from './mint-usdc';

const NETWORK = 'devnet';

async function sendSol(
  recipientAddress: string,
  amount: number
): Promise<string> {
  console.log(`\n💸 Sending ${amount} SOL...`);

  const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

  // Load the mint authority (which has SOL) as the payer
  const payer = await loadMintAuthority();
  console.log(`✓ Payer: ${payer.publicKey.toBase58()}`);

  const recipient = new PublicKey(recipientAddress);
  console.log(`✓ Recipient: ${recipient.toBase58()}`);

  // Create transfer instruction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: amount * LAMPORTS_PER_SOL,
    })
  );

  // Send transaction
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);

  console.log(`✅ SOL Transfer Successful!`);
  console.log(`  Transaction: ${signature}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`);

  return signature;
}

async function fundWallet(
  recipientAddress: string,
  solAmount: number,
  usdcAmount: number
): Promise<void> {
  console.log('🎯 Funding Wallet\n');
  console.log(`Recipient: ${recipientAddress}`);
  console.log(`SOL Amount: ${solAmount}`);
  console.log(`USDC Amount: ${usdcAmount}\n`);

  try {
    // Send SOL
    await sendSol(recipientAddress, solAmount);

    // Mint USDC
    await mintUsdc(recipientAddress, usdcAmount);

    console.log('\n✅ Wallet funded successfully!');
  } catch (error) {
    console.error('Error funding wallet:', error);
    throw error;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: ts-node fund-wallet.ts <recipient-address> [sol-amount] [usdc-amount]');
    console.log('Example: ts-node fund-wallet.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.05 100');
    process.exit(1);
  }

  const recipientAddress = args[0];
  const solAmount = args[1] ? parseFloat(args[1]) : 0.05;
  const usdcAmount = args[2] ? parseFloat(args[2]) : 100;

  try {
    await fundWallet(recipientAddress, solAmount, usdcAmount);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { fundWallet, sendSol };
