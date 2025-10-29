import { Config } from '../config';

interface FaucetResult {
  signature: string;
  amount: number;
  tokenAccount: string;
  mint: string;
  explorerUrl?: string;
  message?: string;
}

export class UsdcFaucetError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRateLimit?: boolean,
    public readonly shouldRetry?: boolean,
  ) {
    super(message);
    this.name = 'UsdcFaucetError';
  }
}

class FaucetService {
  /**
   * Request USDC from verifier service (secure backend minting)
   * Mobile app never has access to mint authority
   */
  async requestUsdc(ownerAddress: string, amount: number = 100): Promise<FaucetResult> {
    try {
      if (__DEV__) {
        console.log(`[USDC Faucet] Requesting ${amount} USDC for ${ownerAddress}`);
      }

      // Call verifier service to mint USDC
      const verifierUrl = Config.services.verifier || 'https://beam-verifier.vercel.app';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${verifierUrl}/test-usdc/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerAddress,
          amount,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new UsdcFaucetError(
          `Verifier mint failed: ${response.status} ${errorText}`,
          response.status,
          response.status === 429,
          response.status >= 500
        );
      }

      const result = await response.json();

      if (__DEV__) {
        console.log('[USDC Faucet] Mint successful:', result.signature);
      }

      const explorerUrl = this.buildExplorerUrl(result.signature);

      return {
        signature: result.signature,
        amount: result.amount || amount,
        tokenAccount: result.tokenAccount,
        mint: result.mint || Config.tokens.usdc.mint,
        explorerUrl,
        message: `Minted ${amount.toFixed(2)} USDC to your wallet via verifier service.`,
      };
    } catch (err) {
      if (err instanceof UsdcFaucetError) {
        if (__DEV__) {
          console.error('[USDC Faucet] Error:', err.message);
        }
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      if (__DEV__) {
        console.error('[USDC Faucet] Unexpected error:', message);
      }

      // Check if it's a network error
      if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
        throw new UsdcFaucetError(
          `Network error: Unable to reach verifier service. Please check your connection.`,
          undefined,
          false,
          true
        );
      }

      throw new UsdcFaucetError(`Failed to request test USDC: ${message}`, undefined, false, true);
    }
  }

  private buildExplorerUrl(signature: string): string | undefined {
    const cluster = Config.solana.network;
    if (!signature || signature === 'unknown') {
      return undefined;
    }
    if (cluster === 'mainnet-beta') {
      return `https://explorer.solana.com/tx/${signature}`;
    }
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
  }
}

export const faucetService = new FaucetService();
