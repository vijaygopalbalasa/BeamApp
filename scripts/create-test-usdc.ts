import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createMint, getMint } from '@solana/spl-token';
import * as fs from 'fs';
import bs58 from 'bs58';

const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Generate a new keypair for the mint authority
  const mintAuthority = Keypair.generate();
  console.log('\n=== NEW USDC MINT AUTHORITY ===');
  console.log('Public Key:', mintAuthority.publicKey.toBase58());
  console.log('Secret Key (base58):', bs58.encode(mintAuthority.secretKey));

  // We need SOL to pay for the mint creation
  console.log('\n=== REQUESTING SOL AIRDROP ===');
  const airdropSignature = await connection.requestAirdrop(
    mintAuthority.publicKey,
    2 * 1e9 // 2 SOL
  );
  await connection.confirmTransaction(airdropSignature);
  console.log('Airdrop confirmed:', airdropSignature);

  // Create the mint
  console.log('\n=== CREATING USDC MINT ===');
  const mint = await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey, // mint authority
    null, // freeze authority (null = no freeze)
    6 // decimals (USDC uses 6 decimals)
  );

  console.log('USDC Mint created:', mint.toBase58());

  // Verify the mint
  const mintInfo = await getMint(connection, mint);
  console.log('\n=== MINT INFO ===');
  console.log('Mint address:', mint.toBase58());
  console.log('Decimals:', mintInfo.decimals);
  console.log('Mint authority:', mintInfo.mintAuthority?.toBase58());
  console.log('Supply:', mintInfo.supply.toString());

  // Save to config file
  const configPath = '/Users/vijaygopalb/Beam/mobile/beam-app/src/config/index.ts';
  let configContent = fs.readFileSync(configPath, 'utf-8');

  // Replace the mint address
  configContent = configContent.replace(
    /mint: '[^']+'/,
    `mint: '${mint.toBase58()}'`
  );

  // Replace the authority secret
  configContent = configContent.replace(
    /mintAuthoritySecret: '[^']+'/,
    `mintAuthoritySecret: '${bs58.encode(mintAuthority.secretKey)}'`
  );

  fs.writeFileSync(configPath, configContent);
  console.log('\n✅ Config updated successfully!');
  console.log('\nNEW CONFIGURATION:');
  console.log(`  USDC Mint: ${mint.toBase58()}`);
  console.log(`  Authority: ${mintAuthority.publicKey.toBase58()}`);
  console.log(`  Authority Secret: ${bs58.encode(mintAuthority.secretKey)}`);
}

main().catch(console.error);
