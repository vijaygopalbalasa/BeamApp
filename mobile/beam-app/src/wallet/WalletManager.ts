import { PublicKey } from '@solana/web3.js';
import { SecureStorage, toBase64, fromBase64 } from '../native/SecureStorageBridge';

export interface BeamSigner {
  publicKey: PublicKey;
  sign(message: Uint8Array, reason?: string): Promise<Uint8Array>;
}

class WalletManager {
  private publicKey: PublicKey | null = null;
  private currentNonce = 0;

  private async ensureInitialized(): Promise<void> {
    if (this.publicKey) {
      return;
    }
    const base64Key = await SecureStorage.ensureWalletKeypair();
    const keyBytes = fromBase64(base64Key);
    this.publicKey = new PublicKey(keyBytes);
  }

  async createWallet(): Promise<PublicKey> {
    await SecureStorage.resetWallet().catch(() => {});
    this.publicKey = null;
    await this.ensureInitialized();
    return this.publicKey!;
  }

  async loadWallet(): Promise<PublicKey | null> {
    try {
      await this.ensureInitialized();
      return this.publicKey;
    } catch (err) {
      if (__DEV__) {
        console.warn('Failed to load wallet', err);
      }
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
}

export const wallet = new WalletManager();
