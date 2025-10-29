import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const address = new PublicKey('6yhwhYBPiosbe4vnhJqN51HoxL6c13zbKr2bNwSvgwwu');

  console.log('Requesting 0.05 SOL airdrop to:', address.toBase58());

  try {
    const signature = await connection.requestAirdrop(
      address,
      0.05 * LAMPORTS_PER_SOL
    );

    console.log('Airdrop requested, signature:', signature);
    console.log('Confirming transaction...');

    await connection.confirmTransaction(signature);

    console.log('✅ Airdrop confirmed!');
    console.log('Transaction:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);

    // Check balance
    const balance = await connection.getBalance(address);
    console.log('New balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  } catch (error) {
    console.error('❌ Airdrop failed:', error);
    throw error;
  }
}

main().catch(console.error);
