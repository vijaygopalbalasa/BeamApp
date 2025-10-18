# Solana RPC Provider Guide

Comprehensive guide for selecting and configuring RPC providers for the Beam mobile app.

## Table of Contents

- [Why Use a Dedicated RPC Provider?](#why-use-a-dedicated-rpc-provider)
- [Provider Comparison](#provider-comparison)
- [Detailed Provider Reviews](#detailed-provider-reviews)
- [Configuration Examples](#configuration-examples)
- [Cost Optimization](#cost-optimization)
- [Performance Tuning](#performance-tuning)
- [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

---

## Why Use a Dedicated RPC Provider?

### Public RPC Limitations

The public Solana RPCs (`api.mainnet-beta.solana.com`, `api.devnet.solana.com`) have significant limitations:

- **Rate Limiting**: ~50-100 requests per second
- **No SLA**: No uptime guarantees
- **High Latency**: Shared infrastructure
- **No Support**: Community-only support
- **Limited Features**: Basic RPC methods only
- **Unreliable**: Can be overloaded during high traffic

### Benefits of Dedicated Providers

- **Higher Rate Limits**: 100-10,000+ requests per second
- **Better Performance**: Lower latency, faster responses
- **Reliability**: 99.9%+ uptime SLAs
- **Priority Support**: Dedicated support teams
- **Enhanced APIs**: Additional methods and features
- **WebSocket Support**: Real-time updates
- **Analytics**: Usage monitoring and insights
- **Scalability**: Easily scale with your app

---

## Provider Comparison

| Provider | Free Tier | Starting Price | Rate Limit (Free) | Rate Limit (Paid) | SLA | WebSocket | Support |
|----------|-----------|----------------|-------------------|-------------------|-----|-----------|---------|
| **Helius** | ✅ Yes | $49/mo | 100 req/s | 200-1000+ req/s | 99.9% | ✅ Yes | Email + Discord |
| **QuickNode** | ❌ Trial | $49/mo | N/A | 50-1000+ req/s | 99.99% | ✅ Yes | Email + Chat |
| **Triton (RPC Pool)** | ❌ No | Pay-as-go | N/A | Custom | 99.9% | ✅ Yes | Email |
| **Alchemy** | ✅ Yes | $49/mo | 330 req/s | 330-2000+ req/s | 99.9% | ✅ Yes | Email + Discord |
| **Syndica** | ❌ Contact | Custom | N/A | Custom | 99.99% | ✅ Yes | Dedicated |
| **GenesysGo** | ❌ Contact | Custom | N/A | Custom | Custom | ✅ Yes | Dedicated |

### Recommendation Summary

**For Most Projects**: **Helius** or **Alchemy**
- Great free tiers for development
- Affordable paid plans
- Excellent documentation
- Strong community support

**For High-Volume Production**: **QuickNode** or **Syndica**
- Enterprise-grade infrastructure
- Higher rate limits
- Dedicated support
- Custom SLAs

**For Cost-Conscious**: **RPC Pool**
- Pay-as-you-go pricing
- No minimum commitment
- Good for variable traffic

---

## Detailed Provider Reviews

### 1. Helius (Recommended)

**Website**: https://helius.dev

#### Pros
- Generous free tier (100 req/s)
- Excellent documentation
- Enhanced APIs (webhooks, DAS API)
- Great developer experience
- Active Discord community
- Competitive pricing

#### Cons
- Newer provider (less track record)
- Free tier limited to devnet

#### Pricing
- **Free**: Devnet only, 100 req/s, 10M requests/month
- **Growth**: $49/mo, 200 req/s, 50M requests/month
- **Business**: $249/mo, 500 req/s, 250M requests/month
- **Enterprise**: Custom pricing

#### Features
- Standard Solana RPC methods
- Enhanced APIs (DAS, webhooks)
- WebSocket support
- Transaction parsing
- Monitoring dashboard
- Priority fee API
- IPFS gateway

#### Best For
- Startups and small teams
- Projects needing enhanced APIs
- Development and testing
- Apps requiring webhooks

#### Configuration

```bash
# Mobile App .env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
RPC_RATE_LIMIT=100  # Free tier: 100, Growth: 200

# Verifier .env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com
```

---

### 2. QuickNode

**Website**: https://quicknode.com

#### Pros
- Highest uptime SLA (99.99%)
- Global infrastructure
- Very fast response times
- Excellent enterprise support
- Detailed analytics
- Established provider

#### Cons
- No free tier (7-day trial only)
- More expensive than competitors
- Can be overkill for small projects

#### Pricing
- **Discover**: $49/mo, 50 req/s
- **Build**: $299/mo, 200 req/s
- **Scale**: $799/mo, 500 req/s
- **Enterprise**: Custom pricing

#### Features
- Standard Solana RPC methods
- Global edge network
- Advanced analytics
- Dedicated nodes (higher tiers)
- Archive node access
- API marketplace add-ons
- 24/7 support

#### Best For
- Production applications
- Enterprise customers
- Apps requiring high uptime
- Global applications

#### Configuration

```bash
# Mobile App .env
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
SOLANA_WS_URL=wss://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
RPC_RATE_LIMIT=50  # Discover tier

# Verifier .env
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com
```

---

### 3. Triton (RPC Pool)

**Website**: https://rpcpool.com

#### Pros
- Pay-as-you-go pricing
- No minimum commitment
- High performance
- Reliable infrastructure
- Good for variable traffic

#### Cons
- No free tier
- Pricing can be unpredictable
- Less documentation than others

#### Pricing
- Pay-per-request
- Volume discounts available
- Custom enterprise pricing

#### Features
- Standard Solana RPC methods
- High-performance infrastructure
- WebSocket support
- Flexible pricing
- Monitoring tools

#### Best For
- Variable traffic patterns
- Cost-sensitive projects
- Seasonal applications

#### Configuration

```bash
# Mobile App .env
SOLANA_RPC_URL=https://your-endpoint.rpcpool.com/YOUR_TOKEN
SOLANA_WS_URL=wss://your-endpoint.rpcpool.com/YOUR_TOKEN
RPC_RATE_LIMIT=100  # Based on your plan

# Verifier .env
SOLANA_RPC_URL=https://your-endpoint.rpcpool.com/YOUR_TOKEN
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com
```

---

### 4. Alchemy

**Website**: https://alchemy.com

#### Pros
- Generous free tier (330 req/s)
- Excellent developer tools
- Enhanced APIs
- Strong documentation
- Multi-chain support
- Webhooks and notifications

#### Cons
- Relatively new to Solana
- Fewer Solana-specific features

#### Pricing
- **Free**: 330 req/s, 300M compute units/month
- **Growth**: $49/mo, 660 req/s
- **Scale**: Custom pricing

#### Features
- Standard Solana RPC methods
- Enhanced APIs
- WebSocket support
- Webhooks
- Analytics dashboard
- Multi-chain support
- Debug tools

#### Best For
- Multi-chain projects
- Projects using Alchemy on other chains
- Teams wanting advanced tooling
- Development and testing

#### Configuration

```bash
# Mobile App .env
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SOLANA_WS_URL=wss://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
RPC_RATE_LIMIT=330  # Free tier

# Verifier .env
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com
```

---

### 5. Syndica

**Website**: https://syndica.io

#### Pros
- Enterprise-grade infrastructure
- Very high performance
- Custom SLAs
- Dedicated support
- Used by major protocols

#### Cons
- No public pricing
- Must contact sales
- Overkill for small projects

#### Best For
- Large-scale production apps
- Enterprise customers
- High-volume applications
- Mission-critical systems

---

### 6. GenesysGo (Triton)

**Website**: https://genesysgo.com

#### Pros
- High-performance infrastructure
- Used by major Solana projects
- Dedicated node options
- Solana-focused

#### Cons
- Custom pricing only
- Must contact sales

#### Best For
- Large-scale applications
- Projects needing dedicated infrastructure
- High-reliability requirements

---

## Configuration Examples

### Development Configuration

Use free tiers for development:

```bash
# Option 1: Helius (Devnet only)
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
RPC_RATE_LIMIT=100

# Option 2: Alchemy
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://solana-devnet.g.alchemy.com/v2/YOUR_API_KEY
RPC_RATE_LIMIT=330

# Option 3: Public (no auth required)
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
RPC_RATE_LIMIT=50
```

### Production Configuration

Use paid tiers with fallbacks:

```bash
# Primary: Helius
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
RPC_RATE_LIMIT=200

# In config/index.ts - add fallbacks
rpcEndpoints: [
  {
    http: process.env.SOLANA_RPC_URL,
    ws: process.env.SOLANA_WS_URL,
  },
  // Fallback 1: Public RPC
  { http: 'https://api.mainnet-beta.solana.com' },
  // Fallback 2: Ankr (free alternative)
  { http: 'https://rpc.ankr.com/solana' },
]
```

### High-Availability Configuration

Multiple providers for maximum uptime:

```bash
# Primary: QuickNode
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
SOLANA_WS_URL=wss://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/

# In config/index.ts
rpcEndpoints: [
  {
    http: process.env.SOLANA_RPC_URL,
    ws: process.env.SOLANA_WS_URL,
  },
  // Fallback 1: Helius
  {
    http: 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY',
    ws: 'wss://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY',
  },
  // Fallback 2: Alchemy
  {
    http: 'https://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
    ws: 'wss://solana-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY',
  },
  // Fallback 3: Public
  { http: 'https://api.mainnet-beta.solana.com' },
]
```

---

## Cost Optimization

### Estimate Your Requirements

1. **Calculate Daily Transactions**
   - Active users per day
   - Transactions per user
   - Average RPC calls per transaction

2. **Example Calculation**
   ```
   Users: 1,000 daily
   Transactions per user: 3
   RPC calls per transaction: 10

   Daily calls: 1,000 × 3 × 10 = 30,000
   Monthly calls: 30,000 × 30 = 900,000

   Peak req/s: ~10 req/s (assuming 3-hour peak)
   ```

3. **Choose Appropriate Plan**
   - Helius Free: Up to 10M requests/month
   - Helius Growth: Up to 50M requests/month ($49/mo)
   - Alchemy Free: 300M compute units/month

### Optimization Strategies

#### 1. Cache Aggressively

```typescript
// Cache static data
const programId = Config.program.id; // Don't fetch repeatedly
const usdcMint = Config.tokens.usdc.mint;

// Cache account data with TTL
const CACHE_TTL = 60000; // 1 minute
let cachedBalance: number | null = null;
let cacheTime = 0;

async function getBalance(): Promise<number> {
  if (cachedBalance && Date.now() - cacheTime < CACHE_TTL) {
    return cachedBalance;
  }
  cachedBalance = await fetchBalance();
  cacheTime = Date.now();
  return cachedBalance;
}
```

#### 2. Batch Requests

```typescript
// Instead of multiple calls
const account1 = await connection.getAccountInfo(pubkey1);
const account2 = await connection.getAccountInfo(pubkey2);
const account3 = await connection.getAccountInfo(pubkey3);

// Use batch call
const accounts = await connection.getMultipleAccountsInfo([
  pubkey1,
  pubkey2,
  pubkey3,
]);
```

#### 3. Use Appropriate Commitment Levels

```typescript
// For UI display (faster, less reliable)
const balance = await connection.getBalance(pubkey, 'processed');

// For transactions (default)
const tx = await connection.sendTransaction(transaction, {
  commitment: 'confirmed',
});

// For critical operations (slower, most reliable)
const finalizedTx = await connection.confirmTransaction(signature, 'finalized');
```

#### 4. Implement Exponential Backoff

```typescript
async function fetchWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

#### 5. Monitor and Analyze Usage

- Track RPC calls per feature
- Identify expensive operations
- Optimize or cache frequent queries
- Remove unnecessary calls

---

## Performance Tuning

### Connection Configuration

```typescript
// In BeamProgram.ts or similar
const connection = new Connection(rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000,
  disableRetryOnRateLimit: false, // Let SDK handle rate limits
  httpHeaders: {
    'X-App-Version': Config.app.version,
  },
});
```

### WebSocket for Real-Time Updates

```typescript
// Subscribe to account changes
const subscriptionId = connection.onAccountChange(
  accountPubkey,
  (accountInfo) => {
    console.log('Account updated:', accountInfo);
  },
  'confirmed'
);

// Unsubscribe when done
connection.removeAccountChangeListener(subscriptionId);
```

### Transaction Simulation

```typescript
// Simulate before sending
const simulation = await connection.simulateTransaction(transaction);
if (simulation.value.err) {
  throw new Error(`Simulation failed: ${simulation.value.err}`);
}

// Then send
const signature = await connection.sendTransaction(transaction, signers);
```

---

## Monitoring and Troubleshooting

### Monitor These Metrics

1. **RPC Call Volume**
   - Total calls per day
   - Calls per endpoint
   - Peak traffic periods

2. **Error Rates**
   - Failed requests
   - Timeout errors
   - Rate limit errors

3. **Response Times**
   - Average latency
   - P95/P99 latency
   - Slow endpoints

4. **Costs**
   - Monthly RPC costs
   - Cost per user
   - Cost per transaction

### Common Issues

#### Rate Limiting

**Symptoms**: 429 errors, "Too Many Requests"

**Solutions**:
- Upgrade to higher tier
- Implement request queuing
- Add caching layer
- Use multiple providers

#### High Latency

**Symptoms**: Slow transaction confirmations, timeouts

**Solutions**:
- Switch to faster provider
- Use closer geographic region
- Optimize query patterns
- Increase timeout values

#### Unexpected Costs

**Symptoms**: Bills higher than expected

**Solutions**:
- Audit RPC usage per feature
- Implement more aggressive caching
- Remove unnecessary polling
- Optimize batch operations

### Testing Different Providers

```typescript
// Test script
async function testProvider(rpcUrl: string) {
  const start = Date.now();
  const connection = new Connection(rpcUrl);

  try {
    const slot = await connection.getSlot();
    const latency = Date.now() - start;
    console.log(`✅ ${rpcUrl}: ${latency}ms, slot: ${slot}`);
  } catch (err) {
    console.log(`❌ ${rpcUrl}: ${err.message}`);
  }
}

// Test multiple providers
await testProvider('https://api.mainnet-beta.solana.com');
await testProvider('https://mainnet.helius-rpc.com/?api-key=...');
await testProvider('https://your-endpoint.quiknode.pro/...');
```

---

## Quick Start Guide

### 1. Choose Your Provider

For most projects starting out: **Helius** (free tier for devnet)

### 2. Sign Up

Visit https://helius.dev and create an account

### 3. Get API Key

Copy your API key from the dashboard

### 4. Configure Environment

```bash
# .env
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
RPC_RATE_LIMIT=100
```

### 5. Test Connection

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
```

### 6. Monitor Usage

Check your provider dashboard regularly to track usage

### 7. Plan for Production

Before launching, upgrade to a paid plan with appropriate limits

---

## Summary

### Quick Recommendations

- **Development**: Helius (free devnet) or Alchemy (free with high limits)
- **Small Production**: Helius Growth ($49/mo) or Alchemy Growth ($49/mo)
- **Medium Production**: QuickNode Build ($299/mo) or Helius Business ($249/mo)
- **Large Production**: QuickNode Scale or Enterprise plan

### Key Takeaways

1. Don't rely on public RPCs for production
2. Always configure fallback endpoints
3. Monitor usage and costs regularly
4. Optimize queries to reduce costs
5. Test providers before committing
6. Plan for growth and scaling

---

## Additional Resources

- [Helius Documentation](https://docs.helius.dev)
- [QuickNode Documentation](https://www.quicknode.com/docs/solana)
- [Alchemy Documentation](https://docs.alchemy.com/reference/solana-api-quickstart)
- [Solana RPC API Reference](https://docs.solana.com/api)
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js)
