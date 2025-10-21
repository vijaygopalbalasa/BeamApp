/**
 * Solana Faucet Service
 * Handles SOL airdrop requests with fallback strategies to handle rate limits and internal errors
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Config } from '../config';

interface AirdropResult {
  signature: string;
  amount: number;
  source: 'primary-rpc' | 'fallback-rpc';
}

class SolanaFaucetService {
  private readonly fallbackRpcUrls = [
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    'https://devnet.helius-rpc.com/?api-key=public',
  ];

  /**
   * Request SOL airdrop with fallback strategy
   * Tries multiple RPC endpoints if one fails due to rate limiting or internal errors
   */
  async requestSolAirdrop(
    publicKey: PublicKey,
    amountSol: number = 0.5
  ): Promise<AirdropResult> {
    const amountLamports = amountSol * LAMPORTS_PER_SOL;

    // Try primary RPC first
    try {
      const primaryConnection = new Connection(Config.solana.rpcUrl, 'confirmed');
      const signature = await primaryConnection.requestAirdrop(publicKey, amountLamports);

      // Try to confirm but don't fail if confirmation times out
      try {
        await primaryConnection.confirmTransaction(signature, 'confirmed');
      } catch (confirmErr) {
        if (__DEV__) {
          console.warn('Primary RPC airdrop confirmation timeout:', confirmErr);
        }
      }

      return {
        signature,
        amount: amountSol,
        source: 'primary-rpc',
      };
    } catch (primaryErr) {
      const primaryMessage = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

      // If it's not a rate limit or internal error, throw immediately
      if (
        !primaryMessage.includes('Internal error') &&
        !primaryMessage.includes('internal error') &&
        !primaryMessage.includes('rate limit') &&
        !primaryMessage.includes('429')
      ) {
        throw primaryErr;
      }

      if (__DEV__) {
        console.log('Primary RPC failed, trying fallbacks:', primaryMessage);
      }

      // Try fallback RPC endpoints
      let lastError: Error | undefined;
      for (const rpcUrl of this.fallbackRpcUrls) {
        // Skip if it's the same as primary
        if (rpcUrl === Config.solana.rpcUrl) {
          continue;
        }

        try {
          const fallbackConnection = new Connection(rpcUrl, 'confirmed');
          const signature = await fallbackConnection.requestAirdrop(publicKey, amountLamports);

          // Try to confirm but don't fail if confirmation times out
          try {
            await fallbackConnection.confirmTransaction(signature, 'confirmed');
          } catch (confirmErr) {
            if (__DEV__) {
              console.warn(`Fallback RPC (${rpcUrl}) confirmation timeout:`, confirmErr);
            }
          }

          if (__DEV__) {
            console.log(`Airdrop succeeded using fallback RPC: ${rpcUrl}`);
          }

          return {
            signature,
            amount: amountSol,
            source: 'fallback-rpc',
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (__DEV__) {
            console.log(`Fallback RPC ${rpcUrl} failed:`, lastError.message);
          }
          continue;
        }
      }

      // All endpoints failed, throw the last error
      throw lastError ?? primaryErr;
    }
  }

  /**
   * Check if an error is due to rate limiting
   */
  isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('too many requests')
    );
  }

  /**
   * Check if an error is an internal server error
   */
  isInternalError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('internal error') || message.includes('500');
  }
}

export const solanaFaucetService = new SolanaFaucetService();
