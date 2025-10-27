# Verifier Service Authentication Setup

This guide explains how to set up API key authentication for the BEAM verifier service.

## Overview

The verifier service now requires API key authentication for sensitive endpoints:
- `/verify-attestation` - Attestation verification (REQUIRED)
- All `/api/attestation/*` endpoints (REQUIRED)

Rate limiting is enforced on all endpoints:
- `/verify-attestation` - 20 requests per minute
- `/test-usdc/mint` - 10 requests per minute
- `/relay/upload-bundle` - 50 requests per minute
- `/api/attestation/report-fraud` - 5 requests per minute

## Generating API Keys

### Step 1: Generate a New API Key

Run this Node.js command to generate a new API key and its hash:

```bash
node -e "const crypto = require('crypto'); const key = crypto.randomBytes(32).toString('hex'); console.log('API Key:', key); console.log('Hash:', crypto.createHash('sha256').update(key).digest('hex'));"
```

**Output:**
```
API Key: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
Hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

**IMPORTANT**:
- Store the **API Key** securely (give to mobile app)
- Store the **Hash** in environment variables (never expose publicly)

### Step 2: Configure Environment Variables

#### Local Development (.env file)

```bash
# Enable dev mode (bypasses auth - DO NOT USE IN PRODUCTION)
DEV_MODE=true

# OR configure API key hashes for local testing
API_KEY_MOBILE_APP=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

#### Production (Vercel)

Set environment variables in Vercel dashboard or via CLI:

```bash
# Add API key hash for mobile app
vercel env add API_KEY_MOBILE_APP production
# Paste the hash when prompted

# Add master API key (for admin operations)
vercel env add MASTER_API_KEY_HASH production
# Paste the hash when prompted

# Ensure DEV_MODE is false or not set
vercel env rm DEV_MODE production
```

## Using API Keys in Mobile App

### Update Mobile App Configuration

In [mobile/beam-app/src/config/index.ts](mobile/beam-app/src/config/index.ts):

```typescript
export const Config = {
  // ...
  services: {
    verifier: 'https://beam-verifier.vercel.app',
    verifierApiKey: process.env.VERIFIER_API_KEY || '', // Add this
  },
  // ...
};
```

### Update SettlementService

In `mobile/beam-app/src/services/SettlementService.ts`, update the `verifyWithService` method:

```typescript
private async verifyWithService(
  bundle: OfflineBundle,
  payer: AttestationEnvelope,
  merchant?: AttestationEnvelope
): Promise<VerifierProofs> {
  const endpoint = Config.services?.verifier;
  const apiKey = Config.services?.verifierApiKey;

  if (!endpoint) {
    throw new Error('Verifier service endpoint not configured');
  }

  try {
    const response = await this.withTimeout(
      fetch(`${endpoint}/verify-attestation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`, // Add API key
        },
        body: JSON.stringify({
          // ... existing body
        }),
      }),
      20000
    );

    // ... rest of the method
  }
}
```

### Build Configuration

Set the API key at build time:

```bash
# Android build with API key
cd mobile/beam-app/android
./gradlew assembleRelease \
  -PVERIFIER_URL=https://beam-verifier.vercel.app \
  -PVERIFIER_API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

## Rate Limiting

Rate limits are applied per IP address:

| Endpoint | Limit | Window | Notes |
|----------|-------|--------|-------|
| `/verify-attestation` | 20 req/min | 60s | Strict limit for security |
| `/test-usdc/mint` | 10 req/min | 60s | Test faucet only |
| `/relay/upload-bundle` | 50 req/min | 60s | Bundle uploads |
| `/api/attestation/report-fraud` | 5 req/min | 60s | Fraud reporting |
| All other endpoints | 100 req/min | 60s | General API |

Rate limit information is returned in response headers:
- `RateLimit-Limit` - Maximum requests per window
- `RateLimit-Remaining` - Requests remaining in current window
- `RateLimit-Reset` - Timestamp when window resets

### Rate Limit Response

When rate limit is exceeded:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests from this IP, please try again later. Limit: 20 requests per 60 seconds."
}
```

## Development Mode

For local development and testing, you can bypass authentication:

```bash
# .env file
DEV_MODE=true
```

**WARNING**: Never set `DEV_MODE=true` in production! This completely disables authentication.

## Security Best Practices

### API Key Management

1. **Never commit API keys to git**
   - Add `.env` to `.gitignore`
   - Use environment variables for secrets

2. **Rotate API keys regularly**
   - Generate new keys monthly
   - Update mobile app and verifier simultaneously

3. **Use different keys for different environments**
   - Development: Use test keys
   - Staging: Use staging keys
   - Production: Use production keys

4. **Monitor API key usage**
   - Check verifier logs for failed auth attempts
   - Set up alerts for suspicious activity

### Storing API Keys Securely

**Mobile App:**
- Store in encrypted SharedPreferences
- Use Android Keystore for encryption key
- Never log API keys

**Verifier Service:**
- Store hashes only (never plain keys)
- Use environment variables
- Rotate signing keys independently

## Troubleshooting

### "Missing Authorization header"

**Problem**: Mobile app not sending API key

**Solution**: Add Authorization header to fetch request:
```typescript
headers: {
  'Authorization': `Bearer ${apiKey}`,
}
```

### "Invalid API key"

**Problem**: API key hash doesn't match

**Solution**:
1. Verify API key is correct in mobile config
2. Verify hash in verifier environment matches
3. Regenerate key if needed

### "Authentication not configured"

**Problem**: No API keys configured in verifier

**Solution**: Add at least one API_KEY_* environment variable with hash

### "rate_limit_exceeded"

**Problem**: Too many requests from IP

**Solution**:
1. Wait for rate limit window to reset
2. Implement exponential backoff in mobile app
3. Reduce request frequency

## Testing Authentication

### Test with curl

```bash
# Health check (no auth required)
curl https://beam-verifier.vercel.app/health

# Verify attestation (requires API key)
curl -X POST https://beam-verifier.vercel.app/verify-attestation \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY_HERE' \
  -d '{
    "bundleId": "test-123",
    "bundleSummary": {...},
    "payerAttestation": {...}
  }'
```

### Test rate limiting

```bash
# Send 25 requests quickly (should hit 20 req/min limit)
for i in {1..25}; do
  curl -X POST https://beam-verifier.vercel.app/verify-attestation \
    -H 'Authorization: Bearer YOUR_API_KEY' \
    -H 'Content-Type: application/json' \
    -d '{}' &
done
```

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DEV_MODE` | No | Bypass auth (dev only) | `true` |
| `API_KEY_*` | Yes (prod) | API key hash | `9f86d08...` |
| `MASTER_API_KEY_HASH` | No | Admin key hash | `abc123...` |
| `RATE_LIMIT_MAX` | No | Max requests per window | `100` |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window (ms) | `60000` |

## Migration Guide

If you have an existing deployment without authentication:

1. **Generate API keys** for all clients
2. **Update mobile app** to send Authorization header
3. **Deploy updated mobile app** to test devices
4. **Set `DEV_MODE=true`** temporarily on verifier
5. **Test end-to-end** with new app version
6. **Configure API key hashes** on verifier
7. **Set `DEV_MODE=false`** or remove it
8. **Redeploy verifier** to enable authentication
9. **Monitor logs** for failed auth attempts
10. **Update all clients** to use authenticated endpoints

---

**Last Updated**: 2025-01-27
**Version**: 1.0.0
