import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = 'https://api.devnet.solana.com';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Our mint authority that has SOL
  const fromSecret = '5bmD53xVocRpGacpvHDSyxnG3yJnuwrQddFNBzjZ9p1vggh9mQKXqbrHxDGAogNLmxRY8J4KP5xbn3jJQvcFqqEV';
  const from = Keypair.fromSecretKey(bs58.decode(fromSecret));

  const to = new PublicKey('6yhwhYBPiosbe4vnhJqN51HoxL6c13zbKr2bNwSvgwwu');

  console.log('Sending 0.05 SOL');
  console.log('From:', from.publicKey.toBase58());
  console.log('To:', to.toBase58());

  // Check sender balance
  const senderBalance = await connection.getBalance(from.publicKey);
  console.log('Sender balance:', senderBalance / LAMPORTS_PER_SOL, 'SOL');

  if (senderBalance < 0.05 * LAMPORTS_PER_SOL) {
    throw new Error('Insufficient balance');
  }

  // Create transfer transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    })
  );

  console.log('Sending transaction...');
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [from]
  );

  console.log('✅ Transfer successful!');
  console.log('Signature:', signature);
  console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);

  // Check recipient balance
  const recipientBalance = await connection.getBalance(to);
  console.log('Recipient new balance:', recipientBalance / LAMPORTS_PER_SOL, 'SOL');
}

main().catch(console.error);
