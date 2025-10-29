/**
 * BeamProgram Tests
 * Basic connection and initialization tests
 */

import { Keypair } from '@solana/web3.js';
import { BeamProgramClient } from '../BeamProgram';
import { Config } from '../../config';
import type { BeamSigner } from '../../wallet/WalletManager';
import * as ed from '@noble/ed25519';

describe('BeamProgramClient', () => {
  let client: BeamProgramClient;
  let wallet: BeamSigner;

  beforeAll(() => {
    const keypair = Keypair.generate();

    // Create a proper BeamSigner from the Keypair
    wallet = {
      publicKey: keypair.publicKey,
      sign: async (message: Uint8Array): Promise<Uint8Array> => {
        // Use ed25519 to sign the message
        return ed.sign(message, keypair.secretKey.slice(0, 32));
      },
    };

    client = new BeamProgramClient(Config.solana.rpcUrl, wallet);
  });

  test('should initialize with correct configuration', () => {
    expect(client).toBeDefined();
    expect(client.getProgramId().toString()).toBe(Config.program.id);
    expect(client.getUsdcMint().toString()).toBe(Config.tokens.usdc.mint);
  });

  test('should support read-only mode without signer', () => {
    const readOnlyClient = new BeamProgramClient(Config.solana.rpcUrl);
    expect(readOnlyClient).toBeDefined();
    expect(readOnlyClient.getProgramId().toString()).toBe(Config.program.id);
    expect(readOnlyClient.getUsdcMint().toString()).toBe(Config.tokens.usdc.mint);
  });

  test('should throw error for write operations in read-only mode', async () => {
    const readOnlyClient = new BeamProgramClient(Config.solana.rpcUrl);
    await expect(readOnlyClient.initializeEscrow(1000000)).rejects.toThrow('Signer required for write operations');
  });

  test('should test connection to Devnet', async () => {
    const result = await client.testConnection();
    expect(result).toHaveProperty('connected');
    expect(result).toHaveProperty('programExists');

    if (result.connected) {
      console.log('Successfully connected to Solana Devnet');
      console.log('Program exists:', result.programExists);
    } else {
      console.warn('Failed to connect:', result.error);
    }
  }, 30000); // 30 second timeout for network calls

  test('should check online status', async () => {
    const isOnline = await client.isOnline();
    expect(typeof isOnline).toBe('boolean');
  }, 30000);

  test('should find escrow PDA correctly', () => {
    const [pda, bump] = client.findEscrowPDA(wallet.publicKey);
    expect(pda).toBeDefined();
    expect(typeof bump).toBe('number');
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThan(256);
  });

  test('should return null for non-existent escrow account', async () => {
    const escrow = await client.getEscrowAccount(wallet.publicKey);
    expect(escrow).toBeNull();
  }, 30000);
});
