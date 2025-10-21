import { Config } from '../config';
import { PublicKey, Connection, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

interface FaucetResult {
  signature?: string;
  amount?: number;
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
  private readonly REQUEST_TIMEOUT_MS = 30000;

  async requestUsdc(ownerAddress: string): Promise<FaucetResult> {
    // Validate Solana address format
    try {
      new PublicKey(ownerAddress);
    } catch {
      throw new UsdcFaucetError('Invalid Solana address format');
    }

    // Since the REST API endpoints don't exist (405 errors),
    // we need to:
    // 1. Create associated token account if it doesn't exist
    // 2. Direct user to web faucet for manual funding

    await this.ensureTokenAccount(ownerAddress);

    throw new UsdcFaucetError(
      'USDC faucet does not provide an automated API.\n\n' +
      'Please use the web faucet:\n' +
      `https://spl-token-faucet.com/?token-name=USDC&mint=${Config.tokens.usdc.mint}\n\n` +
      'Or request from Circle (official USDC):\n' +
      'https://faucet.circle.com/',
      405,
      false,
      false,
    );
  }

  private async ensureTokenAccount(ownerAddress: string): Promise<string> {
    try {
      const connection = new Connection(Config.solana.rpcUrl, 'confirmed');
      const owner = new PublicKey(ownerAddress);
      const mint = new PublicKey(Config.tokens.usdc.mint);

      const tokenAccount = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const accountInfo = await connection.getAccountInfo(tokenAccount);

      if (!accountInfo) {
        console.log(
          `USDC token account doesn't exist for ${ownerAddress}. ` +
          `Will be created automatically when receiving tokens.`,
        );
      }

      return tokenAccount.toBase58();
    } catch (err) {
      console.error('Error checking USDC token account:', err);
      throw new UsdcFaucetError(
        'Failed to verify USDC token account. Please check your wallet address.',
      );
    }
  }

  private *uniqueEndpoints(): Iterable<string> {
    const seen = new Set<string>();
    for (const endpoint of this.fallbackEndpoints) {
      if (!endpoint) {
        continue;
      }
      const normalized = endpoint.trim();
      if (normalized.length === 0 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      yield normalized;
    }
  }

  private safeParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch (err) {
      return { raw: text };
    }
  }
}

export const faucetService = new FaucetService();
