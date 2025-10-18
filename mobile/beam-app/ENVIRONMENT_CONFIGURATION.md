# Environment Configuration Guide

This guide explains how to configure the Beam mobile app for different environments (development, staging, production).

## Table of Contents

- [Overview](#overview)
- [Environment Variables](#environment-variables)
- [Network Configurations](#network-configurations)
- [RPC Provider Setup](#rpc-provider-setup)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Overview

The Beam app supports three network environments:
- **devnet**: Development and testing on Solana devnet
- **mainnet-beta**: Production deployment on Solana mainnet
- **localnet**: Local development with a local Solana validator

## Environment Variables

### Mobile App (.env)

Create a `.env` file in the mobile app root directory based on `.env.example`:

```bash
# Copy the example file
cp .env.example .env
```

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SOLANA_NETWORK` | Target Solana network | `devnet`, `mainnet-beta`, `localnet` |
| `SOLANA_RPC_URL` | Primary RPC endpoint | `https://api.devnet.solana.com` |
| `BEAM_PROGRAM_ID` | Deployed Beam program ID | `EgkL1UStUnfUJweWazo9JMtsEA87XpWfgLNU9pZbjCnH` |
| `USDC_MINT` | USDC token mint address | See [Token Addresses](#token-addresses) |
| `VERIFIER_URL` | Attestation verifier service URL | `https://verifier.yourdomain.com` |

#### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_WS_URL` | WebSocket endpoint for real-time updates | Not set |
| `RPC_RATE_LIMIT` | Max requests per second | `50` |
| `VERBOSE_LOGGING` | Enable detailed logging | `false` |
| `ENABLE_SIMULATION` | Simulate transactions before sending | `true` |

### Verifier Service (.env)

The verifier service has its own configuration in `/verifier/.env`:

```bash
cd verifier
cp .env.example .env
```

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node environment | `development`, `production`, `staging` |
| `SOLANA_NETWORK` | Must match mobile app network | `devnet`, `mainnet-beta` |
| `SOLANA_RPC_URL` | RPC endpoint (can be different from app) | `https://api.devnet.solana.com` |
| `VERIFIER_SIGNING_KEY` | Ed25519 private key (hex) | Generate with `openssl rand -hex 32` |
| `VERIFIER_EXPECTED_PACKAGE_NAME` | Android package name | `com.beam.app` |

#### Security Variables

| Variable | Description | Production Value |
|----------|-------------|------------------|
| `DEV_MODE` | Development mode flag | **`false`** |
| `VERIFIER_ALLOW_UNSIGNED` | Allow unsigned attestations | **`false`** |
| `ALLOWED_ORIGINS` | CORS allowed origins | Specific domains only |

## Network Configurations

### Devnet Configuration

For development and testing:

**Mobile App (.env)**
```bash
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=EgkL1UStUnfUJweWazo9JMtsEA87XpWfgLNU9pZbjCnH
USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
VERIFIER_URL=http://localhost:3000
```

**Verifier (.env)**
```bash
NODE_ENV=development
DEV_MODE=true
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
VERIFIER_ALLOW_UNSIGNED=true
```

### Mainnet-Beta Configuration

For production deployment:

**Mobile App (.env)**
```bash
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
BEAM_PROGRAM_ID=YOUR_MAINNET_PROGRAM_ID
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
VERIFIER_URL=https://verifier.yourdomain.com
RPC_RATE_LIMIT=100
VERBOSE_LOGGING=false
ENABLE_SIMULATION=true
```

**Verifier (.env)**
```bash
NODE_ENV=production
DEV_MODE=false
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com,https://your-backup-rpc.com
VERIFIER_SIGNING_KEY=YOUR_SECURE_KEY_HERE
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_ALLOWED_DIGESTS=YOUR_APK_SHA256_DIGEST
VERIFIER_ALLOW_UNSIGNED=false
ALLOWED_ORIGINS=https://yourdomain.com
MAX_REQUESTS_PER_MINUTE=1000
```

### Local Development Configuration

For local Solana validator:

**Mobile App (.env)**
```bash
SOLANA_NETWORK=localnet
SOLANA_RPC_URL=http://localhost:8899
BEAM_PROGRAM_ID=YOUR_LOCAL_PROGRAM_ID
USDC_MINT=YOUR_LOCAL_USDC_MINT
VERIFIER_URL=http://localhost:3000
```

## RPC Provider Setup

### Recommended Providers

For production, use a dedicated RPC provider for better performance and reliability:

#### 1. Helius (Recommended)

- **Website**: https://helius.dev
- **Pricing**: Free tier available, paid plans from $49/mo
- **Features**: High performance, WebSocket support, enhanced APIs
- **Rate Limits**:
  - Free: 100 req/s
  - Growth: 200 req/s
  - Business: 1000+ req/s

**Setup**:
```bash
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
RPC_RATE_LIMIT=100
```

#### 2. QuickNode

- **Website**: https://quicknode.com
- **Pricing**: From $49/mo
- **Features**: Global infrastructure, 99.99% uptime SLA
- **Rate Limits**: Varies by plan (50-1000+ req/s)

**Setup**:
```bash
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
SOLANA_WS_URL=wss://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
```

#### 3. Triton (RPC Pool)

- **Website**: https://rpcpool.com
- **Pricing**: Pay-as-you-go
- **Features**: High throughput, low latency

**Setup**:
```bash
SOLANA_RPC_URL=https://your-endpoint.rpcpool.com/YOUR_TOKEN
```

#### 4. Alchemy

- **Website**: https://alchemy.com
- **Pricing**: Free tier available, paid plans from $49/mo
- **Features**: Enhanced APIs, webhooks, analytics

**Setup**:
```bash
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

### Fallback Configuration

Always configure fallback RPC endpoints for redundancy. The app automatically switches to fallback endpoints if the primary fails.

**In config/index.ts**, fallback endpoints are configured per network:

```typescript
devnet: {
  rpcEndpoints: [
    { http: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com' },
    { http: 'https://api.devnet.solana.com' },
    { http: 'https://rpc.ankr.com/solana_devnet' },
  ],
  // ...
}
```

## Token Addresses

### USDC Mint Addresses

| Network | Address |
|---------|---------|
| **Mainnet** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| **Devnet** | `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` |

### Program Deployment

Deploy your Beam program separately for each network:

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet-beta
```

Update `BEAM_PROGRAM_ID` with the deployed program address.

## Security Considerations

### Production Checklist

- [ ] Set `NODE_ENV=production` for verifier service
- [ ] Set `DEV_MODE=false` in verifier
- [ ] Set `VERIFIER_ALLOW_UNSIGNED=false`
- [ ] Use a secure, randomly generated `VERIFIER_SIGNING_KEY`
- [ ] Configure specific `ALLOWED_ORIGINS` (not `*`)
- [ ] Use dedicated RPC provider with authentication
- [ ] Configure proper `VERIFIER_ALLOWED_DIGESTS` for APK verification
- [ ] Enable rate limiting and monitoring
- [ ] Use HTTPS for all external services
- [ ] Store environment variables securely (never commit to git)
- [ ] Rotate signing keys periodically
- [ ] Monitor RPC usage to avoid rate limiting

### Environment Variable Security

**Never commit sensitive values to git!**

1. Use `.gitignore` to exclude `.env` files
2. Store production secrets in:
   - GitHub Secrets (for CI/CD)
   - AWS Secrets Manager
   - Google Secret Manager
   - HashiCorp Vault
   - Vercel/Netlify environment variables

3. Use different keys for each environment
4. Rotate keys regularly
5. Audit access to production credentials

## Troubleshooting

### RPC Connection Issues

**Problem**: "Failed to connect to Solana RPC"

**Solutions**:
1. Verify `SOLANA_RPC_URL` is correct and accessible
2. Check if you've exceeded rate limits
3. Test the endpoint manually:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
     YOUR_RPC_URL
   ```
4. Try fallback endpoints
5. Check network connectivity

### Transaction Failures

**Problem**: Transactions fail with "blockhash not found" or timeout

**Solutions**:
1. Increase `confirmationTimeout` in config
2. Use `confirmed` commitment level for faster confirmations
3. Use `finalized` for critical operations
4. Check Solana network status: https://status.solana.com
5. Verify you have enough SOL for transaction fees

### Verifier Service Issues

**Problem**: "Verifier rejected attestation payload"

**Solutions**:
1. Verify `SOLANA_NETWORK` matches between app and verifier
2. Check `VERIFIER_URL` is accessible from the app
3. Ensure `VERIFIER_SIGNING_KEY` is configured
4. In production, verify attestation configuration is correct
5. Check verifier logs for detailed error messages

### Environment Variable Not Loading

**Problem**: Environment variables show default values

**Solutions**:
1. Verify `.env` file exists in correct location
2. Restart Metro bundler: `npm start -- --reset-cache`
3. Rebuild the app
4. Check `react-native-dotenv` is configured in `babel.config.js`
5. Verify variable names match exactly (case-sensitive)

## Additional Resources

- [Solana Documentation](https://docs.solana.com)
- [Anchor Documentation](https://www.anchor-lang.com)
- [RPC Providers Comparison](https://solana.com/rpc)
- [Solana Network Status](https://status.solana.com)
- [SPL Token Documentation](https://spl.solana.com/token)
