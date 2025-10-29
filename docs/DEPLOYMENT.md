# Beam Payment System - Deployment Guide

## Overview

This document provides step-by-step instructions for deploying the Beam offline payment system to production.

## Architecture

```
┌──────────────────┐
│  Mobile App      │
│  (React Native)  │
└────────┬─────────┘
         │
         ├─── BLE Direct P2P ───┐
         │                      │
         ├─── Verifier API ─────┤
         │                      │
         └─── Solana RPC ───────┤
                                │
                    ┌───────────┴───────────┐
                    │  Backend Services     │
                    ├───────────────────────┤
                    │  • Verifier (Node.js) │
                    │  • Attestation API    │
                    │  • Bundle Relay       │
                    │  • USDC Faucet        │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │  Solana Network       │
                    ├───────────────────────┤
                    │  • Beam Program       │
                    │  • Escrow Accounts    │
                    │  • Token Program      │
                    └───────────────────────┘
```

## Prerequisites

### Development Environment
- Node.js v18+ and pnpm
- Android Studio with SDK 34
- Solana CLI v1.18+
- Anchor v0.30+

### Production Environment
- VPS or cloud server for verifier backend
- Domain name with SSL certificate
- Solana devnet/mainnet RPC endpoint
- USDC mint authority (for testnet)

## Component Deployment

### 1. Solana Program Deployment

#### Build the Program
```bash
cd program
anchor build
```

#### Deploy to Devnet
```bash
# Set Solana to devnet
solana config set --url https://api.devnet.solana.com

# Deploy program
anchor deploy

# Note the program ID from output
# Program Id: <PROGRAM_ID>
```

#### Update Program ID
Edit `mobile/beam-app/src/config/index.ts`:
```typescript
export const Config = {
  solana: {
    programId: '<PROGRAM_ID>', // Update this
    rpcUrl: 'https://api.devnet.solana.com',
    network: 'devnet',
  },
  // ...
};
```

### 2. Verifier Backend Deployment

#### Configure Environment
Create `/verifier/.env`:
```bash
# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=<PROGRAM_ID>

# Verifier Configuration
VERIFIER_PRIVATE_KEY=<BASE58_PRIVATE_KEY>
VERIFIER_ALLOW_DEV=true

# USDC Mint (Devnet)
USDC_MINT_ADDRESS=<USDC_MINT_ADDRESS>
USDC_MINT_AUTHORITY_PATH=./usdc-mint-authority.json

# Server Configuration
PORT=3000
HOST=0.0.0.0
```

#### Install Dependencies
```bash
cd verifier
pnpm install
```

#### Build and Start
```bash
# Build TypeScript
pnpm build

# Start production server
pnpm start

# Or use PM2 for production
pm2 start dist/index.js --name beam-verifier
```

#### Verify Deployment
```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","devMode":true}
```

### 3. Mobile App Deployment

#### Configure App
Edit `mobile/beam-app/src/config/index.ts`:
```typescript
export const Config = {
  solana: {
    programId: '<DEPLOYED_PROGRAM_ID>',
    rpcUrl: '<PRODUCTION_RPC_URL>',
    network: 'mainnet-beta', // or 'devnet'
  },
  services: {
    verifier: 'https://verifier.yourdomain.com', // Production URL
    faucet: null, // Disable for mainnet
  },
  tokens: {
    usdc: {
      mint: '<USDC_MINT_ADDRESS>',
      decimals: 6,
    },
  },
  ble: {
    serviceUUID: '00006265-0000-1000-8000-00805f9b34fb', // Don't change
  },
};
```

#### Build Production APK

**1. Update Version**
Edit `mobile/beam-app/android/app/build.gradle`:
```gradle
android {
    defaultConfig {
        versionCode 1
        versionName "1.0.0"
    }
}
```

**2. Generate Signing Key**
```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore beam-release.keystore \
  -alias beam-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

**3. Configure Signing**
Edit `mobile/beam-app/android/gradle.properties`:
```properties
BEAM_RELEASE_STORE_FILE=beam-release.keystore
BEAM_RELEASE_KEY_ALIAS=beam-key
BEAM_RELEASE_STORE_PASSWORD=<YOUR_PASSWORD>
BEAM_RELEASE_KEY_PASSWORD=<YOUR_PASSWORD>
```

**4. Build Release APK**
```bash
cd mobile/beam-app/android
./gradlew assembleRelease

# APK location:
# app/build/outputs/apk/release/app-release.apk
```

**5. Install on Device**
```bash
adb install app/build/outputs/apk/release/app-release.apk
```

## Network Endpoints

### Devnet
- **Solana RPC**: `https://api.devnet.solana.com`
- **Solana Explorer**: `https://explorer.solana.com/?cluster=devnet`
- **Program ID**: See deployment output
- **Verifier**: Your deployed backend URL

### Mainnet (Production)
- **Solana RPC**: `https://api.mainnet-beta.solana.com` or use Helius/Alchemy
- **Solana Explorer**: `https://explorer.solana.com`
- **USDC Mint**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Program ID**: Deploy your own
- **Verifier**: Production backend with SSL

## Security Checklist

### Pre-Production
- [ ] All API keys in environment variables (not hardcoded)
- [ ] Verifier backend uses HTTPS with valid SSL certificate
- [ ] Program ID matches deployed program
- [ ] Signing keys stored securely (not in git)
- [ ] Dev mode disabled (`VERIFIER_ALLOW_DEV=false`)
- [ ] Faucet endpoints disabled for mainnet
- [ ] Rate limiting enabled on backend
- [ ] Proper error handling and logging

### Production Hardening
- [ ] Enable ProGuard/R8 for APK
- [ ] Implement certificate pinning for API calls
- [ ] Add Firebase Crashlytics for error tracking
- [ ] Set up monitoring and alerting
- [ ] Regular security audits of smart contract
- [ ] Penetration testing of mobile app
- [ ] Implement proper key rotation strategy

## Testing Checklist

### Functional Testing
- [ ] Wallet creation and secure storage
- [ ] SOL and USDC funding
- [ ] Escrow account creation
- [ ] Offline payment creation (customer)
- [ ] BLE payment transfer
- [ ] Payment receipt (merchant)
- [ ] Online settlement
- [ ] Attestation queue processing
- [ ] Bundle relay service
- [ ] Fraud reporting

### BLE Testing
- [ ] Connection establishment (< 5s)
- [ ] Automatic reconnection on disconnect
- [ ] ACK/NACK delivery confirmation
- [ ] Chunk transfer for large bundles
- [ ] Timeout handling
- [ ] Duplicate detection
- [ ] Progress tracking

### Network Resilience
- [ ] Offline payment creation
- [ ] Attestation queue when offline
- [ ] Bundle relay synchronization
- [ ] Graceful degradation
- [ ] Recovery after network restoration

## Monitoring

### Backend Metrics
```bash
# Check verifier health
curl https://verifier.yourdomain.com/health

# Check relay stats
curl https://verifier.yourdomain.com/relay/stats
```

### App Diagnostics
- BLE Direct diagnostics in `CustomerScreen` and `MerchantScreen`
- Attestation queue status in logs
- Bundle relay diagnostics

### Solana Program
- Monitor escrow accounts
- Track fraud reports
- Monitor stake slashing events

## Troubleshooting

### Issue: Verifier backend offline
**Solution**: App falls back to:
1. Attestation queue (will process when online)
2. Pure BLE transfer (no attestation)
3. QR code fallback

### Issue: BLE connection fails
**Solution**: Check:
- Bluetooth permissions granted
- Both devices have BLE node started
- Devices are within range (< 10m)
- No other BLE-intensive apps running

### Issue: Settlement fails
**Solution**: Check:
- Sufficient SOL for transaction fees
- Valid merchant signature on bundle
- Escrow has sufficient balance
- Program ID matches deployed program

### Issue: Attestation timeout
**Solution**:
- Bundles will be queued and retried
- Check verifier backend is accessible
- Verify network connectivity
- Check attestation queue in app logs

## Rollback Procedure

If you need to rollback:

1. **Mobile App**: Install previous APK version
2. **Backend**: Revert to previous git commit and redeploy
3. **Smart Contract**: Deploy previous version (new program ID required)

## Support

For issues:
1. Check logs in Android Logcat: `adb logcat | grep Beam`
2. Check verifier logs: `pm2 logs beam-verifier`
3. Review Solana transaction on explorer
4. Open issue on GitHub

## License

Proprietary - Beam Payment System
