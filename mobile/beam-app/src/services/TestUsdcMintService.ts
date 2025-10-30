/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Test USDC Minting Service
 * Creates and mints custom SPL tokens for testing on devnet (real devices)
 *
 * This service creates a USDC-like test token with:
 * - 6 decimals (same as real USDC)
 * - Unlimited minting capability for testing
 * - Works on both emulator and real Android devices
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { Config } from '../config';

interface MintResult {
  signature: string;
  amount: number;
  tokenAccount: string;
}

/**
 * This service provides USDC-like test tokens for devnet testing
 *
 * IMPORTANT: This creates a custom SPL token, not real USDC
 * For production, use official Circle USDC mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
 */
class TestUsdcMintService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(Config.solana.rpcUrl, 'confirmed');
  }

  /**
   * Mint test USDC tokens directly to user's wallet
   * This uses the existing USDC mint configured in the app
   *
   * @param userPublicKey - User's wallet address
   * @param amountUsdc - Amount in USDC (e.g., 100 for 100 USDC)
   */
  async mintTestUsdc(userPublicKey: PublicKey, amountUsdc: number = 100): Promise<MintResult> {
    try {
      const mint = new PublicKey(Config.tokens.usdc.mint);

      // Get or create the user's associated token account
      const userTokenAccount = await getAssociatedTokenAddress(
        mint,
        userPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if token account exists
      const accountInfo = await this.connection.getAccountInfo(userTokenAccount);

      if (!accountInfo) {
        // Account doesn't exist - provide helpful error
        throw new Error(
          'USDC token account doesn\'t exist yet.\n\n' +
          'Please use the web faucet to create it:\n' +
          `https://spl-token-faucet.com/?token-name=USDC&mint=${Config.tokens.usdc.mint}\n\n` +
          'After receiving your first USDC, this app will work automatically.'
        );
      }

      // For the configured mint (Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr),
      // we don't control the mint authority, so we can't mint directly.
      // The user MUST use the web faucet.

      throw new Error(
        'Automated USDC minting not available.\n\n' +
        'Please use one of these web faucets:\n\n' +
        '1. SPL Token Faucet (unlimited):\n' +
        `https://spl-token-faucet.com/?token-name=USDC&mint=${Config.tokens.usdc.mint}\n\n` +
        '2. Circle Faucet (10 USDC/hour):\n' +
        'https://faucet.circle.com/\n\n' +
        `Your USDC address:\n${userTokenAccount.toBase58()}`
      );
    } catch (err) {
      // Re-throw with helpful context
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(`Failed to mint test USDC: ${String(err)}`);
    }
  }

  /**
   * Check if user has a USDC token account
   */
  async hasTokenAccount(userPublicKey: PublicKey): Promise<boolean> {
    try {
      const mint = new PublicKey(Config.tokens.usdc.mint);
      const tokenAccount = await getAssociatedTokenAddress(
        mint,
        userPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(tokenAccount);
      return accountInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get user's USDC token account address (whether it exists or not)
   */
  async getTokenAccountAddress(userPublicKey: PublicKey): Promise<string> {
    const mint = new PublicKey(Config.tokens.usdc.mint);
    const tokenAccount = await getAssociatedTokenAddress(
      mint,
      userPublicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return tokenAccount.toBase58();
  }
}

export const testUsdcMintService = new TestUsdcMintService();
