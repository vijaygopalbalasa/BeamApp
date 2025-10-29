# Environment Configuration Guide

This document explains how to configure the Beam mobile app using environment variables.

## Overview

The Beam app uses a `.env` file as the single source of truth for configuration. This approach:
- Keeps sensitive data out of version control
- Makes it easy to switch between development and production environments
- Allows for easy configuration overrides without code changes

## Quick Start

1. **Copy the template:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your values:**
   ```bash
   # Update VERIFIER_URL for your environment
   VERIFIER_URL=https://beam-verifier.vercel.app
   ```

3. **Rebuild the app:**
   ```bash
   # For JavaScript changes, restart Metro:
   pnpm start -- --reset-cache

   # For native changes (Android BuildConfig), rebuild:
   cd android && ./gradlew clean && cd ..
   pnpm android
   ```

## Configuration Hierarchy

Values are loaded in the following priority order (highest to lowest):

1. **gradle.properties** (Android-specific overrides)
2. **Environment variables** (shell/system environment)
3. **.env file** (recommended location)
4. **Hardcoded defaults** (fallback values in code)

### Example Override Flow

```bash
# 1. Default from code
Config.services.verifier = 'https://beam-verifier.vercel.app'

# 2. Override via .env file
VERIFIER_URL=http://localhost:3000

# 3. Override via gradle.properties
VERIFIER_URL=https://staging-verifier.vercel.app

# 4. Override via command line
./gradlew assembleRelease -PVERIFIER_URL=https://prod-verifier.vercel.app
```

## Environment Variables Reference

### Network Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SOLANA_NETWORK` | Network to connect to (`devnet`, `mainnet-beta`, `localnet`) | `devnet` | Yes |
| `SOLANA_RPC_URL` | Solana RPC endpoint URL | `https://api.devnet.solana.com` | Yes |
| `SOLANA_WS_URL` | WebSocket endpoint for real-time updates | - | No |
| `RPC_RATE_LIMIT` | Rate limit for RPC calls (req/s) | `50` | No |

### Beam Program Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BEAM_PROGRAM_ID` | Deployed Beam program address | `6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi` | Yes |

### Token Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `USDC_MINT` | USDC token mint address | `CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N` (Devnet) | Yes |
| `USDC_DECIMALS` | Token decimals | `6` | No |

### External Services

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `VERIFIER_URL` | Backend attestation verifier URL | `https://beam-verifier.vercel.app` | Yes |

### App Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `APP_NAME` | Application name | `Beam` | No |
| `APP_VERSION` | Application version | `1.0.0` | No |

### Feature Flags

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `VERBOSE_LOGGING` | Enable verbose logging (`true`/`false`) | `false` | No |
| `ENABLE_SIMULATION` | Enable transaction simulation (`true`/`false`) | `true` | No |

### Development Only

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `CLOUD_PROJECT_ID` | Google Cloud project ID (for Play Integrity) | - | Dev only |
| `CLOUD_PROJECT_NUMBER` | Google Cloud project number | - | Dev only |
| `SOLANA_WALLET_ADDRESS` | Test wallet address (devnet only) | - | Dev only |
| `SOLANA_WALLET_PRIVATE_KEY` | Test wallet private key (devnet only) | - | Dev only |

⚠️ **NEVER commit actual wallet private keys to git!**

## Usage in Code

### TypeScript/JavaScript

The app uses `react-native-dotenv` to load environment variables:

```typescript
import { VERIFIER_URL, BEAM_PROGRAM_ID } from '@env';

// Use in your code
const verifierUrl = VERIFIER_URL || 'https://beam-verifier.vercel.app';
```

### Android Native (Kotlin)

Environment variables are available in Kotlin via `BuildConfig`:

```kotlin
import com.beam.app.BuildConfig

// Access in Kotlin code
val verifierUrl = BuildConfig.VERIFIER_URL
val network = BuildConfig.SOLANA_NETWORK
```

## Environment-Specific Configurations

### Development (.env)

```env
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi
USDC_MINT=CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N
VERIFIER_URL=http://localhost:3000
VERBOSE_LOGGING=true
```

### Staging (.env.staging)

```env
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi
USDC_MINT=CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N
VERIFIER_URL=https://staging-verifier.vercel.app
VERBOSE_LOGGING=true
```

### Production (.env.production)

```env
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
BEAM_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
VERIFIER_URL=https://beam-verifier.vercel.app
VERBOSE_LOGGING=false
```

## Common Tasks

### Switch Between Local and Production Verifier

```bash
# Edit .env
VERIFIER_URL=http://localhost:3000  # Local
# or
VERIFIER_URL=https://beam-verifier.vercel.app  # Production

# Restart Metro
pnpm start -- --reset-cache
```

### Build Release APK with Custom Verifier

```bash
cd android
./gradlew assembleRelease -PVERIFIER_URL=https://prod-verifier.vercel.app
```

### Use Different RPC Provider

```bash
# Edit .env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
RPC_RATE_LIMIT=100

# Restart Metro
pnpm start -- --reset-cache
```

### Test with Mainnet Configuration

```bash
# Edit .env
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Restart app
pnpm android
```

## Troubleshooting

### Environment Variables Not Loading

**Problem:** Changes to `.env` are not reflected in the app.

**Solutions:**
1. Restart Metro bundler with cache reset:
   ```bash
   pnpm start -- --reset-cache
   ```

2. Rebuild the app (for Android BuildConfig changes):
   ```bash
   cd android && ./gradlew clean && cd ..
   pnpm android
   ```

3. Check file location (must be at `/Users/vijaygopalb/Beam/mobile/beam-app/.env`)

### TypeScript Import Errors

**Problem:** `Cannot find module '@env'`

**Solution:** Ensure `types/env.d.ts` exists and is properly configured:

```typescript
// types/env.d.ts
declare module '@env' {
  export const VERIFIER_URL: string;
  // ... other exports
}
```

### Android BuildConfig Not Found

**Problem:** `BuildConfig.VERIFIER_URL` is undefined in Kotlin.

**Solution:**
1. Check that `buildConfig true` is enabled in `android/app/build.gradle`
2. Rebuild the app:
   ```bash
   cd android && ./gradlew clean build
   ```

### .env File Committed to Git

**Problem:** Accidentally committed `.env` file with secrets.

**Solution:**
1. Remove from git:
   ```bash
   git rm --cached .env
   ```

2. Ensure `.gitignore` includes `.env`:
   ```gitignore
   .env
   .env.local
   .env.*.local
   ```

3. Rotate any exposed secrets immediately!

## Best Practices

### Security

1. ✅ **DO:**
   - Use `.env.example` as a template
   - Keep `.env` in `.gitignore`
   - Use different API keys for dev/staging/prod
   - Rotate keys periodically
   - Use HTTPS for all production services

2. ❌ **DON'T:**
   - Commit `.env` to version control
   - Share API keys in public channels
   - Use production keys in development
   - Hardcode sensitive values in code

### Configuration Management

1. ✅ **DO:**
   - Document all environment variables
   - Provide sensible defaults
   - Validate required variables at startup
   - Use `.env.example` for onboarding

2. ❌ **DON'T:**
   - Mix configuration formats
   - Duplicate config across files
   - Use inconsistent variable names
   - Forget to update documentation

## Additional Resources

- [react-native-dotenv Documentation](https://github.com/goatandsheep/react-native-dotenv)
- [Android BuildConfig](https://developer.android.com/reference/tools/gradle-api/com/android/build/api/dsl/BuildFeatures#buildConfig())
- [12-Factor App Config](https://12factor.net/config)

## Support

For issues or questions about environment configuration:
1. Check this guide first
2. Review `.env.example` for reference values
3. Check the main README.md or CLAUDE.md
4. Create an issue on GitHub (without exposing secrets!)
