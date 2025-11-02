/**
 * Centralized Balance Service
 *
 * Single source of truth for all wallet balances (SOL, USDC, Escrow).
 * Implements offline-first patterns with:
 * - Automatic caching to AsyncStorage
 * - Wallet-specific cache keys
 * - Cache expiration (24 hours)
 * - Optimistic updates for offline payments
 * - Pending transaction tracking
 *
 * Based on React Native offline-first best practices (2025):
 * - Single repository pattern
 * - Time-based cache expiration
 * - Conflict resolution on sync
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PublicKey } from '@solana/web3.js';
import { connectionService } from './ConnectionService';
import { BeamProgramClient } from '../solana/BeamProgram';
import { Config } from '../config';

export interface BalanceSnapshot {
  walletAddress: string;
  solBalance: number;
  usdcBalance: number;
  escrowBalance: number;
  escrowExists: boolean;
  updatedAt: number; // timestamp
  pendingPayments: PendingPayment[]; // offline payments not yet settled
}

export interface PendingPayment {
  bundleId: string;
  amount: number; // in USDC
  timestamp: number;
  type: 'sent' | 'received';
}

const CACHE_KEY_PREFIX = '@beam:balance_cache:';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

class BalanceService {
  private currentSnapshot: BalanceSnapshot | null = null;

  /**
   * Get cache key for specific wallet
   */
  private getCacheKey(walletAddress: string): string {
    return `${CACHE_KEY_PREFIX}${walletAddress}`;
  }

  /**
   * Check if cached data is still fresh
   */
  private isCacheValid(snapshot: BalanceSnapshot): boolean {
    const age = Date.now() - snapshot.updatedAt;
    return age < CACHE_TTL;
  }

  /**
   * Calculate effective escrow balance including pending payments
   */
  private calculateEffectiveBalance(snapshot: BalanceSnapshot): number {
    let effective = snapshot.escrowBalance;

    // Subtract pending sent payments
    for (const payment of snapshot.pendingPayments) {
      if (payment.type === 'sent') {
        effective -= payment.amount;
      }
      // Note: We don't add 'received' payments to escrow balance
      // They're tracked separately until settlement
    }

    return Math.max(0, effective); // Never negative
  }

  /**
   * Load cached balance for wallet
   */
  async loadCachedBalance(walletAddress: string): Promise<BalanceSnapshot | null> {
    try {
      const key = this.getCacheKey(walletAddress);
      const cached = await AsyncStorage.getItem(key);

      if (!cached) {
        console.log('[BalanceService] No cache found for wallet:', walletAddress.slice(0, 8));
        return null;
      }

      let snapshot: BalanceSnapshot;
      try {
        snapshot = JSON.parse(cached);
      } catch (jsonErr) {
        console.error('[BalanceService] Corrupt cache JSON, clearing...', jsonErr);
        await AsyncStorage.removeItem(key);
        return null;
      }

      // Validate cache belongs to this wallet
      if (snapshot.walletAddress !== walletAddress) {
        console.warn('[BalanceService] Cache wallet mismatch, clearing...');
        await AsyncStorage.removeItem(key);
        return null;
      }

      // Check if cache is expired
      if (!this.isCacheValid(snapshot)) {
        console.warn('[BalanceService] Cache expired (>24h old)');
        return null;
      }

      console.log('[BalanceService] ✅ Loaded valid cache:', {
        escrow: snapshot.escrowBalance,
        pending: snapshot.pendingPayments.length,
        age: Math.round((Date.now() - snapshot.updatedAt) / 1000 / 60) + ' min',
      });

      this.currentSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      console.error('[BalanceService] Failed to load cache:', error);
      return null;
    }
  }

  /**
   * Save balance snapshot to cache
   */
  private async saveCachedBalance(snapshot: BalanceSnapshot): Promise<void> {
    try {
      const key = this.getCacheKey(snapshot.walletAddress);
      await AsyncStorage.setItem(key, JSON.stringify(snapshot));
      console.log('[BalanceService] ✅ Cached balance for', snapshot.walletAddress.slice(0, 8));
      this.currentSnapshot = snapshot;
    } catch (error) {
      console.error('[BalanceService] Failed to save cache:', error);
    }
  }

  /**
   * Fetch fresh balances from blockchain (ONLINE ONLY)
   */
  async fetchFreshBalances(pubkey: PublicKey, online: boolean): Promise<BalanceSnapshot> {
    const walletAddress = pubkey.toBase58();
    console.log('[BalanceService] Fetching fresh balances for:', walletAddress.slice(0, 8));

    if (!online) {
      console.log('[BalanceService] ⚠️ Offline, returning cached balance');
      const cached = await this.loadCachedBalance(walletAddress);
      if (cached) {
        return cached;
      }
      // No cache available offline, return empty snapshot
      console.warn('[BalanceService] No cache available offline!');
      return {
        walletAddress,
        solBalance: 0,
        usdcBalance: 0,
        escrowBalance: 0,
        escrowExists: false,
        updatedAt: Date.now(),
        pendingPayments: [],
      };
    }

    try {
      // Fetch SOL and USDC balances
      const balances = await connectionService.getAllBalances(pubkey);

      // Fetch escrow balance
      let escrowBalance = 0;
      let escrowExists = false;

      try {
        const connection = connectionService.getConnection();
        const client = new BeamProgramClient(connection);
        const escrowAccount = await client.getEscrowAccount(pubkey);

        if (escrowAccount) {
          escrowExists = true;
          const decimals = Config.tokens.usdc.decimals ?? 6;
          const scale = Math.pow(10, decimals);
          escrowBalance = escrowAccount.escrowBalance / scale;
          console.log('[BalanceService] ✅ Escrow balance:', escrowBalance, 'USDC');
        } else {
          console.log('[BalanceService] Escrow account does not exist');
        }
      } catch (escrowErr) {
        console.log('[BalanceService] Could not fetch escrow:', escrowErr);
        // If error, check if we have cached escrow
        const cached = await this.loadCachedBalance(walletAddress);
        if (cached && cached.escrowExists) {
          console.log('[BalanceService] Using cached escrow from previous fetch');
          escrowBalance = cached.escrowBalance;
          escrowExists = cached.escrowExists;
        }
      }

      // Load existing pending payments from cache
      const cached = await this.loadCachedBalance(walletAddress);
      const pendingPayments = cached?.pendingPayments ?? [];

      const snapshot: BalanceSnapshot = {
        walletAddress,
        solBalance: balances.solBalance,
        usdcBalance: balances.usdcBalance,
        escrowBalance,
        escrowExists,
        updatedAt: Date.now(),
        pendingPayments, // Preserve pending payments
      };

      // Save to cache
      await this.saveCachedBalance(snapshot);

      return snapshot;
    } catch (error) {
      console.error('[BalanceService] Failed to fetch fresh balances:', error);

      // On error, return cache if available
      const cached = await this.loadCachedBalance(walletAddress);
      if (cached) {
        console.log('[BalanceService] Returning cached balance after fetch error');
        return cached;
      }

      // No cache, throw error
      throw error;
    }
  }

  /**
   * Get current balance (cached or fresh)
   */
  async getBalance(pubkey: PublicKey, online: boolean): Promise<BalanceSnapshot> {
    const walletAddress = pubkey.toBase58();

    // If we have fresh cache in memory, return it
    if (this.currentSnapshot && this.currentSnapshot.walletAddress === walletAddress) {
      const age = Date.now() - this.currentSnapshot.updatedAt;
      if (age < 5000) { // Fresh if < 5 seconds old
        console.log('[BalanceService] Using in-memory cache (< 5s old)');
        return this.currentSnapshot;
      }
    }

    // Try to load from AsyncStorage cache
    const cached = await this.loadCachedBalance(walletAddress);

    // If offline, return cache (or empty if no cache)
    if (!online) {
      console.log('[BalanceService] Offline mode, using cache');
      if (cached) {
        return cached;
      }
      console.warn('[BalanceService] No cache available while offline!');
      return {
        walletAddress,
        solBalance: 0,
        usdcBalance: 0,
        escrowBalance: 0,
        escrowExists: false,
        updatedAt: Date.now(),
        pendingPayments: [],
      };
    }

    // Online: fetch fresh data
    console.log('[BalanceService] Online mode, fetching fresh data');
    return await this.fetchFreshBalances(pubkey, online);
  }

  /**
   * Add a pending offline payment (optimistic update)
   */
  async addPendingPayment(walletAddress: string, bundleId: string, amount: number, type: 'sent' | 'received'): Promise<void> {
    console.log('[BalanceService] Adding pending payment:', { bundleId, amount, type });

    const cached = await this.loadCachedBalance(walletAddress);
    if (!cached) {
      console.error('[BalanceService] Cannot add pending payment - no cache exists!');
      return;
    }

    // Add to pending payments
    cached.pendingPayments.push({
      bundleId,
      amount,
      timestamp: Date.now(),
      type,
    });

    // Save updated cache
    await this.saveCachedBalance(cached);

    console.log('[BalanceService] ✅ Added pending payment, total pending:', cached.pendingPayments.length);
  }

  /**
   * Remove a pending payment (after settlement)
   */
  async removePendingPayment(walletAddress: string, bundleId: string): Promise<void> {
    console.log('[BalanceService] Removing pending payment:', bundleId);

    const cached = await this.loadCachedBalance(walletAddress);
    if (!cached) {
      console.error('[BalanceService] Cannot remove pending payment - no cache exists!');
      return;
    }

    // Remove from pending payments
    cached.pendingPayments = cached.pendingPayments.filter(p => p.bundleId !== bundleId);

    // Save updated cache
    await this.saveCachedBalance(cached);

    console.log('[BalanceService] ✅ Removed pending payment, remaining:', cached.pendingPayments.length);
  }

  /**
   * Get effective escrow balance (actual - pending sent)
   */
  async getEffectiveEscrowBalance(walletAddress: string): Promise<number> {
    const cached = await this.loadCachedBalance(walletAddress);
    if (!cached) {
      return 0;
    }
    return this.calculateEffectiveBalance(cached);
  }

  /**
   * Clear cache for wallet (useful for testing or logout)
   */
  async clearCache(walletAddress: string): Promise<void> {
    const key = this.getCacheKey(walletAddress);
    await AsyncStorage.removeItem(key);
    if (this.currentSnapshot?.walletAddress === walletAddress) {
      this.currentSnapshot = null;
    }
    console.log('[BalanceService] Cache cleared for:', walletAddress.slice(0, 8));
  }
}

// Singleton export
export const balanceService = new BalanceService();
