# Configuration Quick Reference

Fast reference guide for common configuration tasks.

## Table of Contents

- [Environment Setup](#environment-setup)
- [Network Switching](#network-switching)
- [Common Configurations](#common-configurations)
- [Troubleshooting](#troubleshooting)
- [Security Checklist](#security-checklist)

---

## Environment Setup

### First Time Setup

```bash
# 1. Clone and install
git clone <your-repo>
cd beam-app
npm install

# 2. Create environment file
cp .env.example .env

# 3. Edit .env with your values
# See .env.example for detailed comments

# 4. Start the app
npm start
```

### Environment Files

| File | Location | Purpose |
|------|----------|---------|
| `.env` | `/beam-app/.env` | Mobile app config (git-ignored) |
| `.env.example` | `/beam-app/.env.example` | Template with comments |
| `config/index.ts` | `/beam-app/src/config/index.ts` | Main config file |
| Verifier `.env` | `/verifier/.env` | Verifier service config |

---

## Network Switching

### Switch to Devnet

```bash
# Mobile App .env
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=<your-devnet-program-id>
USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
```

```bash
# Verifier .env
NODE_ENV=development
DEV_MODE=true
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
```

**Then restart:**
```bash
npm start -- --reset-cache
```

### Switch to Mainnet

```bash
# Mobile App .env
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
BEAM_PROGRAM_ID=<your-mainnet-program-id>
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
VERIFIER_URL=https://verifier.yourdomain.com
VERBOSE_LOGGING=false
```

```bash
# Verifier .env
NODE_ENV=production
DEV_MODE=false
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
VERIFIER_ALLOW_UNSIGNED=false
```

**Then rebuild:**
```bash
npm start -- --reset-cache
# Rebuild app completely
```

### Switch to Local Validator

```bash
# Start local validator first
solana-test-validator

# Mobile App .env
SOLANA_NETWORK=localnet
SOLANA_RPC_URL=http://localhost:8899
BEAM_PROGRAM_ID=<deploy-program-locally>
USDC_MINT=<create-test-token>
```

---

## Common Configurations

### Configuration Matrix

| Scenario | Network | RPC Provider | Verifier | Cost |
|----------|---------|--------------|----------|------|
| **Local Dev** | localnet | localhost:8899 | localhost:3000 | Free |
| **Remote Dev** | devnet | Helius Free | localhost:3000 | Free |
| **Staging** | devnet | Helius Growth | Staging server | ~$50/mo |
| **Production** | mainnet-beta | Helius/QuickNode | Production server | $50-500/mo |

### Token Addresses Reference

| Network | USDC Mint |
|---------|-----------|
| Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Devnet | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` |

### RPC Endpoints Quick Reference

| Provider | Devnet | Mainnet |
|----------|--------|---------|
| **Public** | `https://api.devnet.solana.com` | `https://api.mainnet-beta.solana.com` |
| **Helius** | `https://devnet.helius-rpc.com/?api-key=KEY` | `https://mainnet.helius-rpc.com/?api-key=KEY` |
| **Alchemy** | `https://solana-devnet.g.alchemy.com/v2/KEY` | `https://solana-mainnet.g.alchemy.com/v2/KEY` |
| **QuickNode** | Contact provider | `https://your-endpoint.solana-mainnet.quiknode.pro/TOKEN/` |

### Commitment Levels

| Level | Speed | Reliability | Use Case |
|-------|-------|-------------|----------|
| `processed` | Fastest | Lowest | UI updates (can be rolled back) |
| `confirmed` | Medium | Medium | Default for most operations |
| `finalized` | Slowest | Highest | Critical operations, settlements |

**Configuration:**
```typescript
// In config/index.ts - already configured per network
devnet: {
  commitment: 'confirmed',  // Good balance
}
'mainnet-beta': {
  commitment: 'confirmed',  // Can change to 'finalized' for critical ops
}
```

---

## Troubleshooting

### "Environment variable not loading"

```bash
# 1. Verify .env file exists
ls -la .env

# 2. Check variable name (case-sensitive)
cat .env | grep SOLANA_NETWORK

# 3. Restart Metro with cache reset
npm start -- --reset-cache

# 4. Rebuild app
# Android
cd android && ./gradlew clean && cd ..
npm run android

# iOS
cd ios && rm -rf Pods && pod install && cd ..
npm run ios
```

### "Cannot connect to RPC"

```bash
# Test RPC endpoint manually
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $SOLANA_RPC_URL

# Check network
ping api.devnet.solana.com

# Try fallback endpoint
# Update config/index.ts to log which endpoint is being used
```

### "Transaction failed - blockhash not found"

```bash
# Increase timeout in config/index.ts
confirmationTimeout: 90000,  // Increase from 60000 to 90000

# Or switch to 'finalized' commitment
commitment: 'finalized',
```

### "Program not found"

```bash
# Verify program deployed to correct network
solana program show $BEAM_PROGRAM_ID --url devnet

# Check if BEAM_PROGRAM_ID matches deployed program
echo $BEAM_PROGRAM_ID

# Redeploy if necessary
anchor deploy --provider.cluster devnet
```

### "Verifier rejected attestation"

```bash
# 1. Check verifier is running
curl http://localhost:3000/health

# 2. Verify network matches
# Mobile app and verifier must be on same network

# 3. Check verifier logs
# Look for detailed error messages

# 4. In development, allow unsigned
# Verifier .env
VERIFIER_ALLOW_UNSIGNED=true
```

---

## Security Checklist

### Development

- [ ] `.env` file is in `.gitignore`
- [ ] Using test tokens and devnet
- [ ] Local verifier for testing
- [ ] Dev mode enabled in verifier

### Staging

- [ ] Separate RPC API keys from production
- [ ] Staging verifier deployed
- [ ] Test data only
- [ ] HTTPS enabled

### Production

- [ ] `SOLANA_NETWORK=mainnet-beta`
- [ ] Paid RPC provider configured
- [ ] Production program ID set
- [ ] Mainnet USDC mint configured
- [ ] Production verifier deployed with HTTPS
- [ ] `DEV_MODE=false` in verifier
- [ ] `VERIFIER_ALLOW_UNSIGNED=false`
- [ ] `VERBOSE_LOGGING=false`
- [ ] Strong `VERIFIER_SIGNING_KEY` generated
- [ ] CORS properly restricted
- [ ] Rate limiting configured
- [ ] Monitoring and alerts set up
- [ ] All secrets secured (not in git)
- [ ] Different keys than staging/dev

---

## Configuration Files Reference

### Mobile App

**config/index.ts** - Main configuration
- Network detection
- RPC endpoints (primary + fallbacks)
- Program IDs
- Token addresses
- Commitment levels
- Timeouts and retries
- Feature flags

**Exports:**
```typescript
import { Config, NETWORK_CONFIGS } from '@/config';

// Current configuration
Config.solana.rpcUrl
Config.program.id
Config.tokens.usdc.mint

// All network configs (for debugging)
NETWORK_CONFIGS.devnet
NETWORK_CONFIGS['mainnet-beta']
```

### Verifier Service

**verifier/src/env.ts** - Environment configuration
- Environment detection (dev/staging/prod)
- Solana network configuration
- RPC endpoints with fallbacks
- Attestation settings
- Security validation
- Logging

**Exports:**
```typescript
import {
  VERIFIER_ENV,
  SOLANA_NETWORK,
  SOLANA_RPC_URL,
  VERIFIER_SIGNING_KEY,
} from './env';
```

---

## Quick Commands

### Environment Management

```bash
# Copy template
cp .env.example .env

# View current configuration (without secrets)
cat .env | grep -v "API_KEY\|TOKEN\|SECRET"

# Validate environment
node -e "require('dotenv').config(); console.log(process.env.SOLANA_NETWORK)"

# Test RPC connection
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $(grep SOLANA_RPC_URL .env | cut -d '=' -f2)
```

### Build Commands

```bash
# Clean and rebuild
npm start -- --reset-cache

# Android clean build
cd android && ./gradlew clean && cd .. && npm run android

# iOS clean build
cd ios && rm -rf Pods && pod install && cd .. && npm run ios

# Verifier rebuild
cd verifier && npm run build && npm start
```

### Deployment

```bash
# Deploy program to devnet
anchor deploy --provider.cluster devnet

# Deploy program to mainnet
anchor deploy --provider.cluster mainnet-beta

# Build production APK
cd android && ./gradlew bundleRelease

# Build production iOS
# Use Xcode: Product > Archive
```

---

## Environment Variable List

### Mobile App (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_NETWORK` | Yes | `devnet` | Network: devnet/mainnet-beta/localnet |
| `SOLANA_RPC_URL` | Yes | Public RPC | Primary RPC endpoint |
| `SOLANA_WS_URL` | No | - | WebSocket endpoint |
| `BEAM_PROGRAM_ID` | Yes | - | Deployed program address |
| `USDC_MINT` | Yes | - | USDC token mint address |
| `USDC_DECIMALS` | No | `6` | USDC decimals |
| `VERIFIER_URL` | Yes | localhost | Verifier service URL |
| `RPC_RATE_LIMIT` | No | `50` | Max requests per second |
| `VERBOSE_LOGGING` | No | `false` | Enable detailed logs |
| `ENABLE_SIMULATION` | No | `true` | Simulate transactions |

### Verifier Service (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Environment: development/staging/production |
| `PORT` | No | `3000` | Server port |
| `DEV_MODE` | Yes | `true` | Development mode (must be false in prod) |
| `SOLANA_NETWORK` | Yes | `devnet` | Must match mobile app |
| `SOLANA_RPC_URL` | Yes | Public RPC | RPC endpoint |
| `SOLANA_FALLBACK_RPCS` | No | - | Fallback RPCs (comma-separated) |
| `VERIFIER_SIGNING_KEY` | Yes* | - | Ed25519 private key (*required in prod) |
| `VERIFIER_EXPECTED_PACKAGE_NAME` | Yes | - | Android package name |
| `VERIFIER_ALLOWED_DIGESTS` | Yes* | - | APK SHA-256 (*required in prod) |
| `VERIFIER_ALLOW_UNSIGNED` | Yes | `false` | Must be false in production |
| `ALLOWED_ORIGINS` | No | `*` | CORS origins (specific in prod) |
| `MAX_REQUESTS_PER_MINUTE` | No | `100` | Rate limit |
| `VERBOSE_LOGGING` | No | `false` | Detailed logs |

---

## Additional Documentation

- **[Environment Configuration Guide](./ENVIRONMENT_CONFIGURATION.md)** - Complete setup guide
- **[Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)** - Step-by-step deployment
- **[RPC Provider Guide](./RPC_PROVIDER_GUIDE.md)** - Choosing and configuring RPC providers

---

## Need Help?

### Documentation
- [Solana Docs](https://docs.solana.com)
- [Anchor Docs](https://www.anchor-lang.com)
- [React Native Docs](https://reactnative.dev)

### RPC Providers
- [Helius Docs](https://docs.helius.dev)
- [QuickNode Docs](https://www.quicknode.com/docs/solana)
- [Alchemy Docs](https://docs.alchemy.com/reference/solana-api-quickstart)

### Support
- Check verifier logs for detailed errors
- Use `VERBOSE_LOGGING=true` for debugging
- Test RPC endpoints manually with curl
- Verify network configuration matches across services
