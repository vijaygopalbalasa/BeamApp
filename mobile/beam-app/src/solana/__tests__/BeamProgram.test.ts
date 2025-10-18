/**
 * BeamProgram Tests
 * Basic connection and initialization tests
 */

import { Keypair } from '@solana/web3.js';
import { BeamProgramClient } from '../BeamProgram';
import { Config } from '../../config';

describe('BeamProgramClient', () => {
  let client: BeamProgramClient;
  let wallet: Keypair;

  beforeAll(() => {
    wallet = Keypair.generate();
    client = new BeamProgramClient(Config.solana.rpcUrl, wallet);
  });

  test('should initialize with correct configuration', () => {
    expect(client).toBeDefined();
    expect(client.getProgramId().toString()).toBe(Config.program.id);
    expect(client.getUsdcMint().toString()).toBe(Config.tokens.usdc.mint);
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
