/**
 * Beam App Configuration
 * Environment-aware configuration with production readiness
 */

import { Commitment } from '@solana/web3.js';

// Type definitions for network environments
export type NetworkEnvironment = 'devnet' | 'mainnet-beta' | 'localnet';

export interface SolanaEndpoint {
  http: string;
  ws?: string;
}

export interface NetworkConfig {
  rpcEndpoints: SolanaEndpoint[];
  wsEndpoint?: string;
  commitment: Commitment;
  programId: string;
  usdcMint: string;
  confirmationTimeout: number;
  skipPreflight: boolean;
  maxRetries: number;
}

// Environment detection
const getEnvironment = (): NetworkEnvironment => {
  // In React Native, you can use react-native-dotenv or process.env
  const env = process.env.SOLANA_NETWORK || 'devnet';
  if (env === 'mainnet-beta' || env === 'mainnet') return 'mainnet-beta';
  if (env === 'localnet') return 'localnet';
  return 'devnet';
};

// Network-specific configurations
const NETWORK_CONFIGS: Record<NetworkEnvironment, NetworkConfig> = {
  // Development/Testing Network
  devnet: {
    rpcEndpoints: [
      // Primary endpoints (add your provider endpoints here)
      { http: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com' },
      // Fallback endpoints
      { http: 'https://api.devnet.solana.com' },
      { http: 'https://rpc.ankr.com/solana_devnet' },
    ],
    commitment: 'confirmed',
    programId: process.env.BEAM_PROGRAM_ID || 'EgkL1UStUnfUJweWazo9JMtsEA87XpWfgLNU9pZbjCnH',
    // USDC Devnet mint
    usdcMint: process.env.USDC_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    confirmationTimeout: 60000, // 60 seconds
    skipPreflight: false,
    maxRetries: 3,
  },

  // Production Network
  'mainnet-beta': {
    rpcEndpoints: [
      // IMPORTANT: Replace with your production RPC endpoints
      // Recommended providers: Helius, QuickNode, Triton, Alchemy
      {
        http: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
        ws: process.env.SOLANA_WS_URL,
      },
      // Fallback endpoints (add multiple for redundancy)
      { http: 'https://api.mainnet-beta.solana.com' },
    ],
    commitment: 'confirmed', // Use 'finalized' for critical operations
    // IMPORTANT: Update with your mainnet program ID
    programId: process.env.BEAM_PROGRAM_ID || 'YOUR_MAINNET_PROGRAM_ID',
    // USDC Mainnet mint
    usdcMint: process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    confirmationTimeout: 90000, // 90 seconds for mainnet
    skipPreflight: false,
    maxRetries: 5, // More retries for production
  },

  // Local Development
  localnet: {
    rpcEndpoints: [{ http: process.env.SOLANA_RPC_URL || 'http://localhost:8899' }],
    commitment: 'processed',
    programId: process.env.BEAM_PROGRAM_ID || 'EgkL1UStUnfUJweWazo9JMtsEA87XpWfgLNU9pZbjCnH',
    usdcMint: process.env.USDC_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    confirmationTimeout: 30000,
    skipPreflight: true,
    maxRetries: 1,
  },
};

// Current environment
const CURRENT_NETWORK: NetworkEnvironment = getEnvironment();
const networkConfig = NETWORK_CONFIGS[CURRENT_NETWORK];

export const Config = {
  // Network Environment
  environment: CURRENT_NETWORK,

  // Solana Network Configuration
  solana: {
    network: CURRENT_NETWORK,
    // Primary RPC endpoint
    rpcUrl: networkConfig.rpcEndpoints[0].http,
    wsUrl: networkConfig.rpcEndpoints[0].ws,
    // Fallback RPC endpoints for redundancy
    fallbackRpcUrls: networkConfig.rpcEndpoints.slice(1).map(ep => ep.http),
    commitment: networkConfig.commitment,
    confirmationTimeout: networkConfig.confirmationTimeout,
    skipPreflight: networkConfig.skipPreflight,
    maxRetries: networkConfig.maxRetries,
    // Rate limiting awareness (adjust based on your RPC provider)
    rateLimitPerSecond: process.env.RPC_RATE_LIMIT ? parseInt(process.env.RPC_RATE_LIMIT) : 50,
  },

  // Beam Program Configuration
  program: {
    id: networkConfig.programId,
  },

  // Token Configuration
  tokens: {
    usdc: {
      mint: networkConfig.usdcMint,
      decimals: 6,
      symbol: 'USDC',
    },
  },

  // App Info
  app: {
    name: 'Beam',
    version: '1.0.0',
  },

  // BLE Configuration
  ble: {
    serviceUUID: '00006265-0000-1000-8000-00805f9b34fb',
    bundleCharUUID: '000062b1-0000-1000-8000-00805f9b34fb',
    responseCharUUID: '000062b2-0000-1000-8000-00805f9b34fb',
    deviceNamePrefix: 'Beam-',
    scanTimeout: 15000,
  },

  // Storage Keys
  storage: {
    bundles: '@beam:bundles',
    nonce: '@beam:nonce',
    wallet: '@beam:wallet',
  },

  // External Services
  services: {
    verifier: process.env.VERIFIER_URL || 'http://localhost:3000',
    usdcFaucet:
      process.env.USDC_FAUCET_URL || 'https://spl-token-faucet.com/api/airdrop',
  },

  // Feature Flags
  features: {
    // Enable detailed logging in development
    verboseLogging: __DEV__ || process.env.VERBOSE_LOGGING === 'true',
    // Enable transaction simulation
    enableSimulation: process.env.ENABLE_SIMULATION !== 'false',
  },
};

// Export network configurations for testing/debugging
export { NETWORK_CONFIGS };
