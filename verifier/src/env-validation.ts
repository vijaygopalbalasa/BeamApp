/**
 * Environment Variable Validation
 *
 * Validates required environment variables at startup to fail fast
 * if configuration is missing.
 */

interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Required environment variables for production
 */
const REQUIRED_ENV_VARS_PROD = [
  'VERIFIER_SIGNING_KEY',        // Ed25519 private key for signing attestations
  'SOLANA_RPC_URL',              // Solana RPC endpoint
  'BEAM_PROGRAM_ID',             // Deployed Solana program address
  'USDC_MINT_ADDRESS',           // USDC token mint
];

/**
 * Optional but recommended environment variables
 */
const RECOMMENDED_ENV_VARS = [
  'API_KEY_MOBILE_APP',          // API key hash for mobile app
  'MASTER_API_KEY_HASH',         // Master API key for admin operations
  'ALLOWED_ORIGINS',             // CORS allowed origins
  'RATE_LIMIT_MAX',              // Max requests per window
  'RATE_LIMIT_WINDOW_MS',        // Rate limit window in milliseconds
];

/**
 * Validate environment variables
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if running in development mode
  const isDev = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
  const isVercel = !!process.env.VERCEL;

  if (isDev) {
    warnings.push('Running in DEV_MODE - authentication and rate limiting are bypassed!');
  }

  // In production (Vercel), require all environment variables
  if (isVercel && !isDev) {
    for (const envVar of REQUIRED_ENV_VARS_PROD) {
      if (!process.env[envVar]) {
        errors.push(`Missing required environment variable: ${envVar}`);
      }
    }

    // Check for at least one API key
    const hasApiKeys = Object.keys(process.env).some(key =>
      key.startsWith('API_KEY_') && process.env[key]
    );
    const hasMasterKey = !!process.env.MASTER_API_KEY_HASH;

    if (!hasApiKeys && !hasMasterKey) {
      errors.push('No API keys configured. Set at least one API_KEY_* or MASTER_API_KEY_HASH');
    }
  }

  // Check recommended variables
  for (const envVar of RECOMMENDED_ENV_VARS) {
    if (!process.env[envVar]) {
      warnings.push(`Missing recommended environment variable: ${envVar}`);
    }
  }

  // Validate VERIFIER_SIGNING_KEY format (should be 32 bytes hex = 64 characters)
  if (process.env.VERIFIER_SIGNING_KEY) {
    const key = process.env.VERIFIER_SIGNING_KEY;
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      errors.push('VERIFIER_SIGNING_KEY must be 64 hex characters (32 bytes)');
    }
  }

  // Validate Solana addresses format (base58, typically 32-44 characters)
  const solanaAddressVars = ['BEAM_PROGRAM_ID', 'USDC_MINT_ADDRESS'];
  for (const envVar of solanaAddressVars) {
    if (process.env[envVar]) {
      const address = process.env[envVar];
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        errors.push(`${envVar} does not appear to be a valid Solana address`);
      }
    }
  }

  // Validate numeric values
  const numericVars = ['RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS'];
  for (const envVar of numericVars) {
    if (process.env[envVar]) {
      const value = parseInt(process.env[envVar]!, 10);
      if (isNaN(value) || value <= 0) {
        errors.push(`${envVar} must be a positive number`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print validation results to console
 */
export function printValidationResults(result: EnvValidationResult): void {
  if (result.errors.length > 0) {
    console.error('\n❌ Environment Validation Errors:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  Environment Validation Warnings:');
    for (const warning of result.warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  if (result.valid && result.warnings.length === 0) {
    console.log('\n✅ Environment validation passed');
  }
}

/**
 * Validate environment and exit if invalid (production only)
 */
export function validateOrExit(): void {
  const result = validateEnvironment();
  printValidationResults(result);

  if (!result.valid) {
    const isVercel = !!process.env.VERCEL;
    if (isVercel) {
      console.error('\n🛑 Exiting due to invalid environment configuration');
      process.exit(1);
    } else {
      console.warn('\n⚠️  Continuing in local mode despite validation errors');
    }
  }
}
