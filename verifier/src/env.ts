import { config } from 'dotenv';
import { derivePublicKey, parseSigningKey } from './crypto.js';

config();

// =============================================================================
// Environment Configuration
// =============================================================================
export type VerifierEnvironment = 'development' | 'production' | 'staging';

const getEnvironment = (): VerifierEnvironment => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  return 'development';
};

export const VERIFIER_ENV = getEnvironment();

// =============================================================================
// Solana Network Configuration
// =============================================================================
export const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ||
  (SOLANA_NETWORK === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

// Fallback RPC endpoints for redundancy
export const SOLANA_FALLBACK_RPCS = (process.env.SOLANA_FALLBACK_RPCS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

// =============================================================================
// Play Integrity & Attestation Configuration
// =============================================================================
export const VERIFIER_ALLOW_DEV = true; // TEMP: Force dev mode until Play Integrity is configured
export const VERIFIER_JWKS_URL = process.env.VERIFIER_JWKS_URL || 'https://www.googleapis.com/androidcheck/v1/attestation/publicKey';
export const VERIFIER_JWKS_PATH = process.env.VERIFIER_JWKS_PATH;
export const VERIFIER_EXPECT_PACKAGE = process.env.VERIFIER_EXPECTED_PACKAGE_NAME;
export const VERIFIER_ALLOW_FETCH = process.env.VERIFIER_ALLOW_FETCH !== 'false';
export const VERIFIER_ALLOW_UNSIGNED = process.env.VERIFIER_ALLOW_UNSIGNED === 'true';
export const VERIFIER_ALLOWED_DIGEST = (process.env.VERIFIER_ALLOWED_DIGESTS || '').split(',').map(v => v.trim()).filter(Boolean);

// =============================================================================
// Signing Key Configuration
// =============================================================================
const DEFAULT_SIGNING_KEY_HEX = '4207d5ec7f1a93f73f083ef709dacafbaea919a62e63842708a09627dc93ab00';

function loadSigningKey(): Uint8Array {
  const raw = process.env.VERIFIER_SIGNING_KEY;
  const parsed = parseSigningKey(raw ?? '');
  if (parsed) {
    return parsed;
  }

  // Tolerant fallback: never crash the function on missing key.
  // Use a default dev key with loud warnings. Replace with a real key ASAP.
  console.warn('[verifier] VERIFIER_SIGNING_KEY missing or invalid. Using default development key (DO NOT USE IN PRODUCTION).');
  return Uint8Array.from(Buffer.from(DEFAULT_SIGNING_KEY_HEX, 'hex'));
}

export const VERIFIER_SIGNING_KEY = loadSigningKey();
export const VERIFIER_PUBLIC_KEY = derivePublicKey(VERIFIER_SIGNING_KEY);

// =============================================================================
// Rate Limiting & Performance
// =============================================================================
export const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '100');
export const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000');

// =============================================================================
// CORS Configuration
// =============================================================================
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

// =============================================================================
// Logging Configuration
// =============================================================================
export const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

// =============================================================================
// Configuration Validation
// =============================================================================
function validateConfig() {
  const errors: string[] = [];

  if (VERIFIER_ENV === 'production') {
    if (!process.env.VERIFIER_SIGNING_KEY) {
      errors.push('VERIFIER_SIGNING_KEY is required in production');
    }
    if (VERIFIER_ALLOW_DEV) {
      errors.push('DEV_MODE must be false in production');
    }
    if (VERIFIER_ALLOW_UNSIGNED) {
      errors.push('VERIFIER_ALLOW_UNSIGNED must be false in production');
    }
    if (ALLOWED_ORIGINS.includes('*')) {
      console.warn('[verifier] WARNING: CORS is set to allow all origins in production');
    }
  }

  if (errors.length > 0) {
    console.warn('[verifier] Configuration issues:', errors);
  }
}

// Validate on startup
validateConfig();

// Log configuration summary
console.log('[verifier] Configuration loaded:', {
  environment: VERIFIER_ENV,
  network: SOLANA_NETWORK,
  devMode: VERIFIER_ALLOW_DEV,
  allowUnsigned: VERIFIER_ALLOW_UNSIGNED,
  rpcUrl: SOLANA_RPC_URL,
  hasFallbacks: SOLANA_FALLBACK_RPCS.length > 0,
});
