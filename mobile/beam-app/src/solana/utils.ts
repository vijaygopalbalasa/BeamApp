/**
 * SIMPLIFIED ATA DERIVATION UTILITY
 *
 * Uses @solana/web3.js's built-in PublicKey.findProgramAddressSync()
 * which does NOT use buffer-layout and is Hermes-compatible.
 *
 * Root Cause of Original Issue:
 * - @solana/spl-token's getAssociatedTokenAddress() uses buffer-layout
 * - buffer-layout has "size of undefined" errors in Hermes
 *
 * Solution:
 * - Use PublicKey.findProgramAddressSync() directly
 * - Manually construct ATA derivation seeds
 * - No buffer-layout dependencies
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Simplified implementation of getAssociatedTokenAddress that uses
 * PublicKey.findProgramAddressSync() instead of buffer-layout.
 *
 * Derives the Associated Token Account (ATA) address for a given mint and owner.
 * ATAs are PDAs derived from: [owner, TOKEN_PROGRAM_ID, mint]
 *
 * @param mint The SPL Token mint address
 * @param owner The owner of the associated token account
 * @param programId The SPL Token program ID (usually TOKEN_PROGRAM_ID)
 * @param associatedTokenProgramId The Associated Token Program ID
 * @returns Promise resolving to the ATA address
 */
export async function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
  associatedTokenProgramId: PublicKey,
): Promise<PublicKey> {
  console.log('[utils] getAssociatedTokenAddress called');
  console.log('[utils] mint:', mint.toBase58());
  console.log('[utils] owner:', owner.toBase58());
  console.log('[utils] programId:', programId.toBase58());
  console.log('[utils] associatedTokenProgramId:', associatedTokenProgramId.toBase58());

  // ATA PDA seeds: [owner, programId, mint]
  const seeds = [
    owner.toBuffer(),
    programId.toBuffer(),
    mint.toBuffer(),
  ];

  console.log('[utils] Calling PublicKey.findProgramAddressSync...');

  try {
    // Use the BUILT-IN synchronous method which does NOT use buffer-layout
    const [ata] = PublicKey.findProgramAddressSync(
      seeds,
      associatedTokenProgramId,
    );

    console.log('[utils] ✅ ATA derived:', ata.toBase58());
    return ata;
  } catch (error) {
    console.error('[utils] ❌ Error deriving ATA:', error);
    throw error;
  }
}
