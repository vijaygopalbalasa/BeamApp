declare module '@env' {
  // Network Configuration
  export const SOLANA_NETWORK: string;
  export const SOLANA_RPC_URL: string;
  export const SOLANA_WS_URL: string;
  export const RPC_RATE_LIMIT: string;

  // Beam Program Configuration
  export const BEAM_PROGRAM_ID: string;

  // Token Configuration
  export const USDC_MINT: string;
  export const USDC_DECIMALS: string;

  // Verifier Service Configuration
  export const VERIFIER_URL: string;

  // App Configuration
  export const APP_NAME: string;
  export const APP_VERSION: string;

  // Feature Flags
  export const VERBOSE_LOGGING: string;
  export const ENABLE_SIMULATION: string;

  // Google Cloud Configuration
  export const CLOUD_PROJECT_ID: string;
  export const CLOUD_PROJECT_NUMBER: string;

  // Wallet Configuration (Development only - NEVER commit actual keys!)
  export const SOLANA_WALLET_ADDRESS: string;
  export const SOLANA_WALLET_PRIVATE_KEY: string;
}
