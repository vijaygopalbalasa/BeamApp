# Solana Configuration for Production

This document provides an overview of the production-ready Solana configuration implemented for the Beam mobile app.

## What's New

The Beam app now has a comprehensive, production-ready configuration system that supports:

- Multiple network environments (devnet, mainnet-beta, localnet)
- Environment-based configuration with automatic detection
- Primary RPC endpoints with automatic fallback support
- WebSocket support for real-time updates
- Configurable commitment levels per network
- Rate limiting awareness
- Transaction retry logic with exponential backoff
- Comprehensive environment variable support
- Security validations for production deployments

## Documentation Overview

| Document | Purpose | Audience |
|----------|---------|----------|
| **[Configuration Quick Reference](./CONFIGURATION_QUICK_REFERENCE.md)** | Fast lookup guide for common tasks | All developers |
| **[Environment Configuration Guide](./ENVIRONMENT_CONFIGURATION.md)** | Complete setup and configuration guide | DevOps, Backend developers |
| **[Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)** | Step-by-step deployment process | DevOps, Release managers |
| **[RPC Provider Guide](./RPC_PROVIDER_GUIDE.md)** | RPC provider selection and optimization | DevOps, Architects |

## Quick Start

### 1. For Development (Devnet)

```bash
# Copy environment template
cp .env.example .env

# Edit .env - minimal required changes:
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=<your-devnet-program-id>
USDC_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr

# Start the app
npm start
```

### 2. For Production (Mainnet)

```bash
# Edit .env for production:
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
BEAM_PROGRAM_ID=<your-mainnet-program-id>
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
VERIFIER_URL=https://verifier.yourdomain.com
VERBOSE_LOGGING=false

# Build for production
# See DEPLOYMENT_CHECKLIST.md
```

## Architecture Changes

### Configuration Structure

```
src/config/
└── index.ts          # Main configuration with network-specific settings

Config exported:
- Config.environment         # Current network (devnet/mainnet-beta/localnet)
- Config.solana.rpcUrl      # Primary RPC endpoint
- Config.solana.fallbackRpcUrls  # Automatic failover endpoints
- Config.solana.commitment  # Network-appropriate commitment level
- Config.program.id         # Network-specific program ID
- Config.tokens.usdc.mint   # Network-specific USDC mint
- Config.services.verifier  # Verifier service URL
```

### Network Configurations

The app now has pre-configured settings for each network:

**Devnet** (Development)
- Commitment: `confirmed`
- Timeout: 60 seconds
- Max retries: 3
- Default RPC: Public devnet RPC
- USDC: Devnet mint address

**Mainnet-Beta** (Production)
- Commitment: `confirmed` (can be `finalized` for critical ops)
- Timeout: 90 seconds
- Max retries: 5
- Default RPC: Configurable (use dedicated provider)
- USDC: Mainnet mint address

**Localnet** (Local Development)
- Commitment: `processed`
- Timeout: 30 seconds
- Max retries: 1
- Default RPC: localhost:8899

### Verifier Service Updates

The verifier service now includes:

- Environment-aware configuration (development/staging/production)
- Solana network configuration matching mobile app
- RPC endpoint configuration with fallbacks
- Configuration validation on startup
- Security checks for production deployments

## Key Features

### 1. Automatic Network Detection

The app automatically detects the network from the `SOLANA_NETWORK` environment variable:

```typescript
const getEnvironment = (): NetworkEnvironment => {
  const env = process.env.SOLANA_NETWORK || 'devnet';
  if (env === 'mainnet-beta' || env === 'mainnet') return 'mainnet-beta';
  if (env === 'localnet') return 'localnet';
  return 'devnet';
};
```

### 2. RPC Failover Support

The configuration includes multiple RPC endpoints per network. The app can automatically fall back to secondary endpoints if the primary fails:

```typescript
devnet: {
  rpcEndpoints: [
    { http: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com' },
    { http: 'https://api.devnet.solana.com' },
    { http: 'https://rpc.ankr.com/solana_devnet' },
  ],
}
```

### 3. Network-Specific Settings

Each network has optimized settings:

```typescript
'mainnet-beta': {
  commitment: 'confirmed',
  confirmationTimeout: 90000,  // 90 seconds
  skipPreflight: false,
  maxRetries: 5,
}
```

### 4. Environment Variables

Comprehensive environment variable support:

**Mobile App:**
- `SOLANA_NETWORK` - Network selection
- `SOLANA_RPC_URL` - Primary RPC endpoint
- `SOLANA_WS_URL` - WebSocket endpoint (optional)
- `BEAM_PROGRAM_ID` - Deployed program address
- `USDC_MINT` - USDC token mint address
- `VERIFIER_URL` - Attestation verifier service
- `RPC_RATE_LIMIT` - Rate limiting configuration
- `VERBOSE_LOGGING` - Detailed logging toggle
- `ENABLE_SIMULATION` - Transaction simulation toggle

**Verifier Service:**
- `NODE_ENV` - Environment (development/staging/production)
- `SOLANA_NETWORK` - Must match mobile app
- `SOLANA_RPC_URL` - RPC endpoint
- `SOLANA_FALLBACK_RPCS` - Fallback endpoints
- `VERIFIER_SIGNING_KEY` - Ed25519 signing key
- Security and attestation configuration

### 5. Security Validations

The verifier service includes production safety checks:

```typescript
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
}
```

## Migration Guide

### If You Have Existing Configuration

The new configuration is backward compatible. Your existing code will continue to work:

```typescript
// Old usage (still works)
import { Config } from '@/config';
const rpcUrl = Config.solana.rpcUrl;
const programId = Config.program.id;

// New features (optional to use)
const fallbackUrls = Config.solana.fallbackRpcUrls;
const network = Config.environment;
const timeout = Config.solana.confirmationTimeout;
```

### Updating Your .env File

1. Backup your current `.env`
2. Copy `.env.example` to `.env`
3. Transfer your existing values
4. Add new optional variables as needed

## RPC Provider Recommendations

For production deployments, we recommend using a dedicated RPC provider:

### Top Choices

1. **Helius** (Best for startups)
   - Free tier: 100 req/s on devnet
   - Paid: Starting at $49/mo
   - Enhanced APIs and webhooks
   - [Setup Guide](./RPC_PROVIDER_GUIDE.md#1-helius-recommended)

2. **QuickNode** (Best uptime)
   - 99.99% SLA
   - Starting at $49/mo
   - Global infrastructure
   - [Setup Guide](./RPC_PROVIDER_GUIDE.md#2-quicknode)

3. **Alchemy** (Best free tier)
   - Free: 330 req/s
   - Paid: Starting at $49/mo
   - Multi-chain support
   - [Setup Guide](./RPC_PROVIDER_GUIDE.md#4-alchemy)

See [RPC Provider Guide](./RPC_PROVIDER_GUIDE.md) for detailed comparisons.

## Testing the Configuration

### Verify Environment Loading

```typescript
// Add to your app initialization
import { Config } from '@/config';

console.log('Environment:', Config.environment);
console.log('Network:', Config.solana.network);
console.log('RPC URL:', Config.solana.rpcUrl);
console.log('Program ID:', Config.program.id);
console.log('USDC Mint:', Config.tokens.usdc.mint);
```

### Test RPC Connection

```bash
# Test from command line
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  YOUR_RPC_URL
```

### Verify Verifier Configuration

```bash
# Start verifier and check startup logs
cd verifier
npm start

# Should see:
# [verifier] Configuration loaded: {
#   environment: 'development',
#   network: 'devnet',
#   devMode: true,
#   ...
# }
```

## Deployment Workflow

### Development → Staging → Production

1. **Development (Devnet)**
   - Use public RPC or free tier
   - Deploy program to devnet
   - Test all features
   - Run verifier locally

2. **Staging (Devnet or Mainnet)**
   - Use paid RPC provider
   - Deploy to staging environment
   - Production-like configuration
   - Integration testing

3. **Production (Mainnet)**
   - Follow [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)
   - Use production RPC provider
   - Deploy program to mainnet
   - Enable monitoring and alerts

## Security Best Practices

### Environment Variables

- ✅ Never commit `.env` files to git
- ✅ Use different API keys for each environment
- ✅ Rotate keys periodically
- ✅ Store production secrets in secure vaults
- ✅ Use HTTPS for all external services

### Production Configuration

- ✅ Set `NODE_ENV=production` for verifier
- ✅ Set `DEV_MODE=false` in verifier
- ✅ Set `VERIFIER_ALLOW_UNSIGNED=false`
- ✅ Use strong, random `VERIFIER_SIGNING_KEY`
- ✅ Configure specific `ALLOWED_ORIGINS` (not `*`)
- ✅ Use dedicated RPC provider with authentication
- ✅ Enable rate limiting
- ✅ Set up monitoring and alerting

See [Deployment Checklist - Security](./DEPLOYMENT_CHECKLIST.md#security-checklist) for complete list.

## Monitoring

### What to Monitor

**RPC Metrics:**
- Request rate and volume
- Error rates
- Latency (P50, P95, P99)
- Costs

**Transaction Metrics:**
- Success rate
- Confirmation times
- Failed transactions
- Retry rates

**Verifier Metrics:**
- Uptime
- Request volume
- Error rates
- Response times

### Recommended Tools

- **RPC Monitoring**: Provider dashboards (Helius, QuickNode, etc.)
- **App Monitoring**: Firebase Analytics, Sentry
- **Server Monitoring**: DataDog, New Relic, CloudWatch
- **Logs**: ELK Stack, Splunk, CloudWatch Logs

## Troubleshooting

See [Configuration Quick Reference - Troubleshooting](./CONFIGURATION_QUICK_REFERENCE.md#troubleshooting) for common issues and solutions.

### Common Issues

1. **Environment variables not loading**
   - Restart Metro bundler with cache reset
   - Rebuild the app
   - Check variable names (case-sensitive)

2. **RPC connection failures**
   - Verify endpoint is accessible
   - Check rate limits
   - Try fallback endpoints
   - Test with curl

3. **Transaction failures**
   - Increase timeout
   - Check commitment level
   - Verify network status
   - Check SOL balance for fees

4. **Verifier rejection**
   - Verify network matches
   - Check configuration
   - Review verifier logs
   - Test attestation flow

## Support and Resources

### Documentation

- [Configuration Quick Reference](./CONFIGURATION_QUICK_REFERENCE.md)
- [Environment Configuration Guide](./ENVIRONMENT_CONFIGURATION.md)
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md)
- [RPC Provider Guide](./RPC_PROVIDER_GUIDE.md)

### External Resources

- [Solana Documentation](https://docs.solana.com)
- [Anchor Documentation](https://www.anchor-lang.com)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js)
- [SPL Token Documentation](https://spl.solana.com/token)

### RPC Provider Docs

- [Helius](https://docs.helius.dev)
- [QuickNode](https://www.quicknode.com/docs/solana)
- [Alchemy](https://docs.alchemy.com/reference/solana-api-quickstart)

## Next Steps

1. ✅ Review [Configuration Quick Reference](./CONFIGURATION_QUICK_REFERENCE.md)
2. ✅ Set up your `.env` file using `.env.example`
3. ✅ Test the configuration in development
4. ✅ Choose an RPC provider using [RPC Provider Guide](./RPC_PROVIDER_GUIDE.md)
5. ✅ Follow [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md) for production

## Changelog

### Version 1.0.0 (Current)

**Added:**
- Network-aware configuration system
- Environment variable support
- RPC failover support
- WebSocket endpoint configuration
- Network-specific commitment levels and timeouts
- Rate limiting awareness
- Verifier environment configuration
- Production security validations
- Comprehensive documentation

**Changed:**
- Configuration structure now supports multiple networks
- Environment variables now control network selection
- Commitment levels optimized per network
- Timeout values adjusted per network

**Migration:**
- Existing code is backward compatible
- Update `.env` file with new variables
- Optional: Use new configuration features

---

## Summary

The Beam app now has a production-ready Solana configuration system that:

- ✅ Supports multiple environments (devnet, mainnet, localnet)
- ✅ Provides automatic RPC failover
- ✅ Includes network-optimized settings
- ✅ Validates production configurations
- ✅ Offers comprehensive documentation
- ✅ Supports major RPC providers
- ✅ Includes security best practices
- ✅ Enables easy environment switching

You're now ready to deploy to production with confidence!
