import { PublicKey } from '@solana/web3.js';
import { SecureStorage, toBase64, fromBase64 } from '../native/SecureStorageBridge';

export interface BeamSigner {
  publicKey: PublicKey;
  sign(message: Uint8Array, reason?: string): Promise<Uint8Array>;
}

class WalletManager {
  private publicKey: PublicKey | null = null;
  private currentNonce = 0;
  private initPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    console.log('[WalletManager] ensureInitialized called');
    // Return cached promise if initialization already in progress
    if (this.initPromise) {
      console.log('[WalletManager] Initialization already in progress, returning cached promise');
      return this.initPromise;
    }

    // Return immediately if already initialized
    if (this.publicKey) {
      console.log('[WalletManager] Already initialized:', this.publicKey.toBase58());
      return;
    }

    console.log('[WalletManager] Starting new initialization...');
    // Cache the initialization promise to prevent concurrent calls
    this.initPromise = this._doInitialization();
    try {
      await this.initPromise;
      console.log('[WalletManager] ✅ Initialization completed successfully');
    } finally {
      // Clear promise once complete to allow future re-initialization if needed
      this.initPromise = null;
    }
  }

  private async _doInitialization(): Promise<void> {
    console.log('[WalletManager] _doInitialization: Calling SecureStorage.ensureWalletKeypair...');
    const base64Key = await SecureStorage.ensureWalletKeypair();
    console.log('[WalletManager] _doInitialization: Got base64 key, length:', base64Key.length);
    console.log('[WalletManager] _doInitialization: Converting from base64...');
    const keyBytes = fromBase64(base64Key);
    console.log('[WalletManager] _doInitialization: Key bytes length:', keyBytes.length);
    console.log('[WalletManager] _doInitialization: Creating PublicKey...');
    this.publicKey = new PublicKey(keyBytes);
    console.log('[WalletManager] ✅ Wallet initialized:', this.publicKey.toBase58());
  }

  async createWallet(): Promise<PublicKey> {
    // Check if wallet already exists - don't destroy it!
    const existingWallet = await this.loadWallet();
    if (existingWallet) {
      if (__DEV__) {
        console.log('[WalletManager] Wallet already exists, returning existing wallet');
      }
      return existingWallet;
    }

    // Only reset and create new wallet if none exists
    await SecureStorage.resetWallet().catch(() => {});
    this.publicKey = null;
    await this.ensureInitialized();
    return this.publicKey!;
  }

  async loadWallet(): Promise<PublicKey | null> {
    console.log('[WalletManager] loadWallet called');
    try {
      console.log('[WalletManager] Calling ensureInitialized...');
      await this.ensureInitialized();
      console.log('[WalletManager] ✅ ensureInitialized completed, publicKey:', this.publicKey?.toBase58());
      return this.publicKey;
    } catch (err) {
      console.error('[WalletManager] ❌ Failed to load wallet', err);
      return null;
    }
  }

  async getSigner(reason?: string): Promise<BeamSigner | null> {
    await this.ensureInitialized();
    if (!this.publicKey) {
      return null;
    }

    const signer: BeamSigner = {
      publicKey: this.publicKey,
      sign: async (message: Uint8Array, prompt?: string) => {
        const signOptions = prompt || reason ? { reason: prompt ?? reason } : undefined;
        const signature = await SecureStorage.signDetached(toBase64(message), signOptions);
        return fromBase64(signature);
      },
    };

    return signer;
  }

  getDisplayAddress(): string {
    return this.publicKey ? this.publicKey.toBase58() : '';
  }

  getPublicKey(): PublicKey | null {
    console.log('[WalletManager] getPublicKey called, returning:', this.publicKey?.toBase58() || 'null');
    return this.publicKey;
  }

  async signMessage(message: Uint8Array, reason?: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    const signature = await SecureStorage.signDetached(toBase64(message), reason ? { reason } : undefined);
    return fromBase64(signature);
  }

  resetNonce(): void {
    this.currentNonce = 0;
  }

  getNextNonce(): number {
    this.currentNonce += 1;
    return this.currentNonce;
  }

  getCurrentNonce(): number {
    return this.currentNonce;
  }

  setNonce(nonce: number): void {
    this.currentNonce = nonce;
  }

  async deleteWallet(): Promise<void> {
    await SecureStorage.resetWallet();
    this.publicKey = null;
    this.currentNonce = 0;
  }

  async exportWallet(passphrase: string): Promise<string> {
    return SecureStorage.exportWallet(passphrase);
  }

  async importWallet(passphrase: string, backup: string): Promise<PublicKey> {
    const pubBase64 = await SecureStorage.importWallet(passphrase, backup);
    const pubKey = new PublicKey(fromBase64(pubBase64));
    this.publicKey = pubKey;
    this.currentNonce = 0;
    return pubKey;
  }
}

export const wallet = new WalletManager();
