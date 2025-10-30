/**
 * WalletManager Unit Tests
 *
 * Tests critical wallet functionality:
 * - Wallet creation and persistence
 * - Nonce management
 * - Signing operations
 * - Error handling
 */

import { wallet } from '../WalletManager';
import { SecureStorage } from '../../native/SecureStorageBridge';

// Mock SecureStorage
jest.mock('../../native/SecureStorageBridge', () => ({
  SecureStorage: {
    ensureWalletKeypair: jest.fn(),
    signDetached: jest.fn(),
    resetWallet: jest.fn(),
  },
  toBase64: (data: Uint8Array) => Buffer.from(data).toString('base64'),
  fromBase64: (data: string) => Uint8Array.from(Buffer.from(data, 'base64')),
}));

describe('WalletManager', () => {
  const mockPublicKeyBase64 = 'Aq3h5FwJz7z3KqT9f8N1L2sP4vR6xY8zA1bC3dE5fG7h';
  const mockSignatureBase64 = 'mockSignature123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset wallet state
    wallet.publicKey = null;
    wallet.currentNonce = 0;
  });

  describe('createWallet', () => {
    it('should create a new wallet if none exists', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);

      const publicKey = await wallet.createWallet();

      expect(publicKey).toBeDefined();
      expect(SecureStorage.ensureWalletKeypair).toHaveBeenCalled();
    });

    it('should not overwrite existing wallet', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);

      // Create first wallet
      const firstKey = await wallet.createWallet();

      // Attempt to create again
      const secondKey = await wallet.createWallet();

      expect(firstKey.toBase58()).toBe(secondKey.toBase58());
      expect(SecureStorage.resetWallet).not.toHaveBeenCalled();
    });
  });

  describe('loadWallet', () => {
    it('should load wallet from secure storage', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);

      const publicKey = await wallet.loadWallet();

      expect(publicKey).toBeDefined();
      expect(SecureStorage.ensureWalletKeypair).toHaveBeenCalled();
    });

    it('should return null on failure', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockRejectedValue(new Error('Storage unavailable'));

      const publicKey = await wallet.loadWallet();

      expect(publicKey).toBeNull();
    });

    it('should cache wallet after first load', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);

      await wallet.loadWallet();
      await wallet.loadWallet();

      // Should only call once due to caching
      expect(SecureStorage.ensureWalletKeypair).toHaveBeenCalledTimes(1);
    });
  });

  describe('signMessage', () => {
    it('should sign message with wallet', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);
      (SecureStorage.signDetached as jest.Mock).mockResolvedValue(mockSignatureBase64);

      await wallet.loadWallet();
      const message = new Uint8Array([1, 2, 3, 4]);
      const signature = await wallet.signMessage(message, 'Test signing');

      expect(signature).toBeDefined();
      expect(SecureStorage.signDetached).toHaveBeenCalled();
    });

    it('should pass reason to secure storage', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);
      (SecureStorage.signDetached as jest.Mock).mockResolvedValue(mockSignatureBase64);

      await wallet.loadWallet();
      const message = new Uint8Array([1, 2, 3]);
      await wallet.signMessage(message, 'Custom reason');

      expect(SecureStorage.signDetached).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ reason: 'Custom reason' })
      );
    });
  });

  describe('nonce management', () => {
    it('should increment nonce correctly', () => {
      wallet.resetNonce();
      expect(wallet.getCurrentNonce()).toBe(0);

      const nonce1 = wallet.getNextNonce();
      expect(nonce1).toBe(1);
      expect(wallet.getCurrentNonce()).toBe(1);

      const nonce2 = wallet.getNextNonce();
      expect(nonce2).toBe(2);
      expect(wallet.getCurrentNonce()).toBe(2);
    });

    it('should set nonce to specific value', () => {
      wallet.setNonce(100);
      expect(wallet.getCurrentNonce()).toBe(100);

      const next = wallet.getNextNonce();
      expect(next).toBe(101);
    });

    it('should reset nonce to zero', () => {
      wallet.setNonce(50);
      wallet.resetNonce();
      expect(wallet.getCurrentNonce()).toBe(0);
    });
  });

  describe('deleteWallet', () => {
    it('should clear wallet data', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);
      (SecureStorage.resetWallet as jest.Mock).mockResolvedValue(undefined);

      await wallet.loadWallet();
      wallet.setNonce(10);

      await wallet.deleteWallet();

      expect(SecureStorage.resetWallet).toHaveBeenCalled();
      expect(wallet.getPublicKey()).toBeNull();
      expect(wallet.getCurrentNonce()).toBe(0);
    });
  });

  describe('getSigner', () => {
    it('should return null if wallet not loaded', async () => {
      const signer = await wallet.getSigner();
      expect(signer).toBeNull();
    });

    it('should return signer with sign function', async () => {
      (SecureStorage.ensureWalletKeypair as jest.Mock).mockResolvedValue(mockPublicKeyBase64);
      (SecureStorage.signDetached as jest.Mock).mockResolvedValue(mockSignatureBase64);

      await wallet.loadWallet();
      const signer = await wallet.getSigner('Test operation');

      expect(signer).toBeDefined();
      expect(signer?.publicKey).toBeDefined();
      expect(typeof signer?.sign).toBe('function');

      if (signer) {
        const message = new Uint8Array([1, 2, 3]);
        const signature = await signer.sign(message);
        expect(signature).toBeDefined();
      }
    });
  });
});
