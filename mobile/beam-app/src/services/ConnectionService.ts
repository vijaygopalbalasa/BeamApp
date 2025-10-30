/**
 * Solana RPC Connection Service
 * Provides reliable connection management with fallback RPC endpoints
 * Prevents balance refresh failures due to single RPC endpoint issues
 */

import { Connection, PublicKey, Commitment } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { Config } from '../config';

interface BalanceResult {
  solBalance: number;
  usdcBalance: number;
  tokenAccount: string;
}

interface ConnectionConfig {
  commitment?: Commitment;
  timeout?: number;
}

class ConnectionService {
  private currentRpcUrl: string = Config.solana.rpcUrl;
  private readonly fallbackRpcUrls = [
    'https://api.devnet.solana.com',
    'https://rpc.ankr.com/solana_devnet',
    'https://solana-devnet-rpc.allthatnode.com',
  ];

  /**
   * Creates a connection with timeout protection
   */
  private createConnection(rpcUrl: string, config?: ConnectionConfig): Connection {
    const commitment = config?.commitment ?? 'confirmed';
    const timeout = config?.timeout ?? 30000;

    return new Connection(rpcUrl, {
      commitment,
      confirmTransactionInitialTimeout: timeout,
      disableRetryOnRateLimit: false,
      httpHeaders: { 'Content-Type': 'application/json' },
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        return fetch(input, {
          ...init,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
      },
    });
  }

  /**
   * Get SOL balance with automatic fallback to alternate RPC endpoints
   */
  async getSolBalance(pubkey: PublicKey, config?: ConnectionConfig): Promise<number> {
    console.log('[ConnectionService] getSolBalance called for:', pubkey.toBase58());
    const endpoints = [Config.solana.rpcUrl, ...this.fallbackRpcUrls];
    console.log('[ConnectionService] Will try endpoints:', endpoints);

    for (let i = 0; i < endpoints.length; i++) {
      try {
        console.log(`[ConnectionService] Trying RPC endpoint #${i}: ${endpoints[i]}`);
        const connection = this.createConnection(endpoints[i], config);
        console.log('[ConnectionService] Connection created, fetching balance...');
        const lamports = await connection.getBalance(pubkey);
        const balance = lamports / 1e9;
        console.log(`[ConnectionService] ✅ SOL balance retrieved: ${balance} SOL (${lamports} lamports)`);

        if (__DEV__ && i > 0) {
          console.log(`[ConnectionService] SOL balance fetched from fallback RPC #${i}`);
        }

        return balance;
      } catch (err) {
        const isLast = i === endpoints.length - 1;
        if (__DEV__) {
          console.warn(
            `[ConnectionService] Failed to get SOL balance from RPC #${i}: ${err instanceof Error ? err.message : String(err)
            }${isLast ? ' (all endpoints exhausted)' : ''}`
          );
        }

        if (isLast) {
          throw new Error(
            `Failed to fetch SOL balance from all RPC endpoints: ${err instanceof Error ? err.message : String(err)
            }`
          );
        }

        // Continue to next endpoint
      }
    }

    throw new Error('Unexpected error: all endpoints failed without throwing');
  }

  /**
   * Get USDC token account balance with automatic fallback and retry logic
   */
  async getUsdcBalance(
    pubkey: PublicKey,
    config?: ConnectionConfig
  ): Promise<{ balance: number; tokenAccount: string }> {
    console.log('[ConnectionService] getUsdcBalance called for:', pubkey.toBase58());
    console.log('[ConnectionService] USDC Mint from config:', Config.tokens.usdc.mint);
    const usdcMint = new PublicKey(Config.tokens.usdc.mint);
    console.log('[ConnectionService] Deriving associated token address...');
    const tokenAccount = await getAssociatedTokenAddress(usdcMint, pubkey);
    console.log('[ConnectionService] Token account derived:', tokenAccount.toBase58());
    const endpoints = [Config.solana.rpcUrl, ...this.fallbackRpcUrls];

    for (let i = 0; i < endpoints.length; i++) {
      try {
        console.log(`[ConnectionService] Trying RPC endpoint #${i} for USDC: ${endpoints[i]}`);
        const connection = this.createConnection(endpoints[i], config);
        console.log('[ConnectionService] Fetching token account info...');
        const account = await getAccount(connection, tokenAccount);
        const balance = Number(account.amount) / Math.pow(10, Config.tokens.usdc.decimals);
        console.log(`[ConnectionService] ✅ USDC balance retrieved: ${balance} USDC (${account.amount} raw)`);

        if (__DEV__ && i > 0) {
          console.log(`[ConnectionService] USDC balance fetched from fallback RPC #${i}`);
        }

        return { balance, tokenAccount: tokenAccount.toBase58() };
      } catch (err) {
        const isLast = i === endpoints.length - 1;
        const message = err instanceof Error ? err.message : String(err);

        // Token account not existing is not an error - return 0
        if (message.includes('could not find account') || message.includes('Invalid param')) {
          if (__DEV__) {
            console.log('[ConnectionService] USDC token account does not exist yet');
          }
          return { balance: 0, tokenAccount: tokenAccount.toBase58() };
        }

        if (__DEV__) {
          console.warn(
            `[ConnectionService] Failed to get USDC balance from RPC #${i}: ${message}${isLast ? ' (all endpoints exhausted)' : ''
            }`
          );
        }

        if (isLast) {
          // If all endpoints fail, return 0 as fallback
          if (__DEV__) {
            console.warn('[ConnectionService] Returning 0 USDC balance after all failures');
          }
          return { balance: 0, tokenAccount: tokenAccount.toBase58() };
        }

        // Continue to next endpoint
      }
    }

    // Fallback: return 0
    return { balance: 0, tokenAccount: tokenAccount.toBase58() };
  }

  /**
   * Get both SOL and USDC balances with single call
   * Uses fallback strategy for maximum reliability
   */
  async getAllBalances(pubkey: PublicKey, config?: ConnectionConfig): Promise<BalanceResult> {
    console.log('[ConnectionService] getAllBalances called for:', pubkey.toBase58());
    console.log('[ConnectionService] Fetching SOL and USDC balances in parallel...');

    // Fetch balances in parallel for speed
    const [solBalance, usdcResult] = await Promise.all([
      this.getSolBalance(pubkey, config),
      this.getUsdcBalance(pubkey, config),
    ]);

    console.log('[ConnectionService] ✅ All balances fetched successfully:', {
      solBalance,
      usdcBalance: usdcResult.balance,
      tokenAccount: usdcResult.tokenAccount,
    });

    return {
      solBalance,
      usdcBalance: usdcResult.balance,
      tokenAccount: usdcResult.tokenAccount,
    };
  }

  /**
   * Get a connection with fallback support (for use in other services)
   */
  getConnection(config?: ConnectionConfig): Connection {
    return this.createConnection(this.currentRpcUrl, config);
  }

  /**
   * Get a connection trying fallbacks until one works
   */
  async getWorkingConnection(config?: ConnectionConfig): Promise<Connection> {
    const endpoints = [Config.solana.rpcUrl, ...this.fallbackRpcUrls];

    for (let i = 0; i < endpoints.length; i++) {
      try {
        const connection = this.createConnection(endpoints[i], config);
        // Test the connection with a simple call
        await connection.getSlot();

        if (__DEV__ && i > 0) {
          console.log(`[ConnectionService] Using fallback RPC #${i}`);
        }

        return connection;
      } catch (err) {
        const isLast = i === endpoints.length - 1;
        if (__DEV__) {
          console.warn(
            `[ConnectionService] RPC #${i} failed health check: ${err instanceof Error ? err.message : String(err)
            }${isLast ? ' (all endpoints exhausted)' : ''}`
          );
        }

        if (isLast) {
          throw new Error('All RPC endpoints are unavailable');
        }
      }
    }

    throw new Error('Unexpected error: all endpoints failed without throwing');
  }

  /**
   * Override default RPC URL for subsequent getConnection() calls.
   * Pass null to reset to Config default.
   */
  setRpcOverride(url: string | null): void {
    this.currentRpcUrl = url || Config.solana.rpcUrl;
    if (__DEV__) {
      console.log('[ConnectionService] RPC override set to', this.currentRpcUrl);
    }
  }

  getCurrentRpcUrl(): string {
    return this.currentRpcUrl;
  }
}

export const connectionService = new ConnectionService();
