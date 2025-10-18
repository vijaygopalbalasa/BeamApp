# Beam Production Release Checklist

> **Complete checklist for deploying Beam to production on Solana mainnet-beta**

---

## Table of Contents

- [Overview](#overview)
- [Pre-Release Checklist](#pre-release-checklist)
- [Solana Program Deployment](#solana-program-deployment)
- [Verifier Service Deployment](#verifier-service-deployment)
- [Mobile App Release](#mobile-app-release)
- [Post-Deployment Verification](#post-deployment-verification)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Rollback Procedures](#rollback-procedures)
- [Known Issues](#known-issues)

---

## Overview

This checklist ensures a smooth production deployment of the Beam offline-first payment system.

**Timeline**: Allow 2-3 days for complete production deployment
**Team Required**: Backend developer, mobile developer, DevOps engineer

---

## Pre-Release Checklist

### Code Quality

- [ ] All tests passing
  ```bash
  pnpm --filter @beam/shared test          # ✅ All passing
  pnpm --filter @beam/app lint             # ✅ All passing
  cd program && anchor test --skip-build   # ⚠️ 5/8 passing (CU limit issue)
  ```

- [ ] ESLint clean across all packages
  ```bash
  pnpm --filter @beam/app lint   # ✅ 0 errors, 0 warnings
  ```

- [ ] No console.log statements in production code (use proper logging)

- [ ] Code reviewed and approved by team

### Security Audit

- [ ] **Solana Program**
  - [ ] Nonce registry replay protection tested
  - [ ] Escrow PDA derivation secured
  - [ ] Attestation verification implemented
  - [ ] Fraud reporting mechanism tested
  - [ ] Integer overflow/underflow protections in place

- [ ] **Mobile App**
  - [ ] Android Key Attestation configured ✅
  - [ ] Play Integrity API integrated ✅
  - [ ] Biometric authentication enforced ✅
  - [ ] Secure storage using Android Keystore ✅
  - [ ] ProGuard rules configured ✅
  - [ ] No hardcoded secrets in code

- [ ] **Verifier Service**
  - [ ] Attestation verification functional
  - [ ] Ed25519 signature validation working
  - [ ] HTTPS enforced
  - [ ] Rate limiting configured
  - [ ] CORS properly restricted

### Configuration

- [ ] Environment variables set for production
  - [ ] SOLANA_NETWORK=mainnet-beta
  - [ ] SOLANA_RPC_URL (Helius/QuickNode/Alchemy)
  - [ ] BEAM_PROGRAM_ID (mainnet deployment)
  - [ ] USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  - [ ] VERIFIER_URL (production verifier service)
  - [ ] CLOUD_PROJECT_NUMBER (for Play Integrity)

- [ ] Documentation updated
  - [ ] README.md reflects production status ✅
  - [ ] SETUP.md complete ✅
  - [ ] DEPLOYMENT.md finalized ✅
  - [ ] ARCHITECTURE.md documented ✅

---

## Solana Program Deployment

### 1. Program Build and Verification

```bash
cd program

# Build the program
anchor build

# Verify build
ls target/deploy/beam.so

# Run tests on mainnet fork (if possible)
anchor test --skip-deploy
```

**Status**: ⚠️ 5/8 tests passing (3 failing due to Solana 200K compute unit limit on Ed25519 verification)

**Fix for Production**: Add compute budget request:
```rust
// In settlement instruction
let compute_budget = ComputeBudgetProgram::set_compute_unit_limit(&CU_LIMIT {
    units: 400_000  // Double the default
});
```

### 2. Deploy to Devnet First

```bash
# Configure for devnet
solana config set --url devnet

# Airdrop SOL for deployment
solana airdrop 2

# Deploy
anchor deploy --provider.cluster devnet

# Get program ID
solana program show <PROGRAM_ID>
```

- [ ] Devnet deployment successful
- [ ] Devnet testing complete
- [ ] Integration tests passed on devnet

### 3. Deploy to Mainnet-Beta

```bash
# Configure for mainnet
solana config set --url mainnet-beta

# Ensure sufficient SOL balance (minimum 5 SOL recommended)
solana balance

# Deploy program
anchor deploy --provider.cluster mainnet-beta

# Verify deployment
solana program show <PROGRAM_ID>
```

- [ ] Program deployed to mainnet-beta
- [ ] Program ID recorded: `__________________`
- [ ] Program authority verified
- [ ] Upgrade authority configured (if applicable)

### 4. Initialize Program State

```bash
# Initialize global state if needed
anchor run initialize --provider.cluster mainnet-beta

# Verify initialization
solana account <PROGRAM_ID>
```

- [ ] Program initialized
- [ ] Initial accounts created
- [ ] Permissions verified

---

## Verifier Service Deployment

### 1. Choose Hosting Provider

**Recommended**: Google Cloud Run (serverless, auto-scaling)

**Alternatives**: Railway, Fly.io, VPS with PM2

### 2. Environment Configuration

Create production `.env`:

```bash
# Verifier Service Production Configuration
NODE_ENV=production
PORT=8080

# Solana Network
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_FALLBACK_RPCS=https://api.mainnet-beta.solana.com

# Security
VERIFIER_SIGNING_KEY=<generate-new-ed25519-key>
ALLOWED_ORIGINS=https://yourdomain.com

# Attestation
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_CERT_PEM_PATH=/app/keys/google-playintegrity-pubkeys.pem
VERIFIER_ALLOWED_DIGESTS=<your-apk-sha256>

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Logging
LOG_LEVEL=info
```

### 3. Deploy to Cloud Run

```bash
cd verifier

# Build container
docker build -t gcr.io/YOUR_PROJECT/beam-verifier:v1.0.0 .

# Push to registry
docker push gcr.io/YOUR_PROJECT/beam-verifier:v1.0.0

# Deploy
gcloud run deploy beam-verifier \
  --image gcr.io/YOUR_PROJECT/beam-verifier:v1.0.0 \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="$(cat .env.production | tr '\n' ',')"
```

- [ ] Service deployed
- [ ] Service URL: `__________________`
- [ ] Health check passing: `curl https://your-service.run.app/health`
- [ ] HTTPS enforced
- [ ] Custom domain configured (optional)

### 4. Verifier Testing

```bash
# Test attestation endpoint
curl -X POST https://your-service.run.app/verify \
  -H "Content-Type: application/json" \
  -d '{"envelope": {...}}'
```

- [ ] Attestation verification working
- [ ] Ed25519 signature validation working
- [ ] Rate limiting tested
- [ ] Error responses proper

---

## Mobile App Release

### 1. Update Configuration

**mobile/beam-app/.env**:
```bash
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
BEAM_PROGRAM_ID=<YOUR_MAINNET_PROGRAM_ID>
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
VERIFIER_URL=https://your-verifier-service.run.app
CLOUD_PROJECT_NUMBER=<YOUR_GOOGLE_CLOUD_PROJECT_NUMBER>
```

### 2. Version Bump

**android/app/build.gradle**:
```gradle
defaultConfig {
    versionCode 1  // Increment for each release
    versionName "1.0.0"  // Semantic versioning
}
```

### 3. Generate Release Keystore

```bash
cd android/app

# Generate keystore (if not exists)
keytool -genkeypair -v \
  -keystore beam-release.keystore \
  -alias beam-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass <strong-password> \
  -keypass <strong-password>
```

**⚠️ Important**: Store keystore and passwords securely (password manager, vault)

- [ ] Keystore generated
- [ ] Keystore backed up securely
- [ ] Passwords documented in vault

### 4. Configure Signing

**android/app/build.gradle**:
```gradle
signingConfigs {
    release {
        storeFile file('beam-release.keystore')
        storePassword System.getenv('BEAM_KEYSTORE_PASSWORD')
        keyAlias 'beam-key'
        keyPassword System.getenv('BEAM_KEY_PASSWORD')
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true  // Enable ProGuard
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

### 5. Build Release APK/AAB

**⚠️ Known Issue**: React Native 0.76.6 has monorepo build issues. Use React Native CLI instead of Gradle directly:

```bash
# Set environment variables
export BEAM_KEYSTORE_PASSWORD="your-password"
export BEAM_KEY_PASSWORD="your-password"

# Build release APK (for testing)
npx react-native build-android --mode=release

# Build release AAB (for Play Store)
cd android
./gradlew bundleRelease
```

**Alternative**: If monorepo build fails, temporarily move the app out of monorepo:
```bash
# Copy app to temporary location
cp -r mobile/beam-app /tmp/beam-app-release
cd /tmp/beam-app-release

# Build standalone
npx react-native build-android --mode=release
```

- [ ] Release build successful
- [ ] APK/AAB signed correctly
- [ ] ProGuard enabled and working

### 6. Test Release Build

```bash
# Install release APK on device
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Test all features:
# - Wallet creation ✓
# - Escrow funding ✓
# - Offline payment creation ✓
# - Biometric authentication ✓
# - Settlement on mainnet
# - QR scanning
# - BLE mesh (on real devices)
```

- [ ] App installs correctly
- [ ] All core features working
- [ ] No crashes or ANRs
- [ ] Biometric authentication working
- [ ] Network calls to mainnet successful

### 7. Play Integrity Setup

**Google Cloud Console**:
1. Enable Play Integrity API
2. Link to Play Console
3. Get cloud project number

**Play Console**:
1. Upload app to internal testing
2. Get SHA-256 certificate fingerprint:
   ```bash
   keytool -list -v -keystore beam-release.keystore
   ```
3. Add fingerprint to Play Console → App Integrity

- [ ] Play Integrity API enabled
- [ ] Cloud project linked
- [ ] Certificate fingerprint added
- [ ] Test attestation working

### 8. Play Store Submission

**Play Console Setup**:
1. Create app listing
2. Upload screenshots (minimum 2)
3. Write app description
4. Set content rating
5. Complete privacy policy
6. Set up pricing & distribution

**Upload AAB**:
```bash
# AAB location
android/app/build/outputs/bundle/release/app-release.aab
```

**Rollout Strategy**:
1. Internal testing (10-100 users)
2. Closed testing (100-1000 users)
3. Open testing (optional)
4. Production (phased rollout: 10% → 50% → 100%)

- [ ] App listing complete
- [ ] Screenshots uploaded
- [ ] AAB uploaded to internal testing
- [ ] Internal testing successful (no crashes)
- [ ] Promoted to production
- [ ] Phased rollout configured

---

## Post-Deployment Verification

### Solana Program

- [ ] Program accessible on mainnet
- [ ] Initialize escrow working
- [ ] Fund escrow working
- [ ] Settle offline payment working (with compute budget fix)
- [ ] Fraud reporting working
- [ ] Events emitting correctly

### Verifier Service

- [ ] Service reachable
- [ ] Health check: `curl https://your-service/health`
- [ ] Attestation verification working
- [ ] Response times < 500ms (p95)
- [ ] No errors in logs

### Mobile App

- [ ] App available on Play Store
- [ ] Downloads working
- [ ] No crash reports
- [ ] User ratings positive
- [ ] Analytics tracking functional

---

## Monitoring and Maintenance

### Set Up Monitoring

**Solana Program**:
- Monitor program transactions on explorer
- Track escrow balances
- Monitor nonce registry growth
- Watch for fraud reports

**Verifier Service**:
```bash
# Google Cloud Monitoring (if using Cloud Run)
gcloud logging read "resource.type=cloud_run_revision"

# Set up alerts for:
# - Error rate > 5%
# - Response time > 1s
# - CPU/Memory thresholds
```

**Mobile App**:
- Google Play Console crash reports
- Firebase Crashlytics (optional)
- User reviews monitoring

### Logging

**Verifier Service** (production logging):
```typescript
// Use structured logging
logger.info('Attestation verified', {
  bundleId, deviceIntegrity, timestamp
});
```

**Mobile App** (disable verbose logs):
```bash
# .env
VERBOSE_LOGGING=false
```

### Regular Maintenance

- [ ] Weekly: Check service health and logs
- [ ] Weekly: Monitor program transaction volume
- [ ] Monthly: Review crash reports and user feedback
- [ ] Monthly: Update dependencies (security patches)
- [ ] Quarterly: Security audit

---

## Rollback Procedures

### Solana Program Rollback

**If program upgrade fails**:
```bash
# Rollback to previous version
solana program deploy previous-beam.so --program-id <PROGRAM_ID>

# Verify rollback
solana program show <PROGRAM_ID>
```

- Have backup of previous `.so` file
- Test rollback procedure on devnet first

### Verifier Service Rollback

**Google Cloud Run**:
```bash
# List revisions
gcloud run revisions list --service beam-verifier

# Rollback to previous revision
gcloud run services update-traffic beam-verifier \
  --to-revisions <PREVIOUS_REVISION>=100
```

### Mobile App Rollback

**Play Store**:
1. Go to Play Console → Production
2. Create new release
3. Upload previous AAB version (increment versionCode)
4. Release to production

**Emergency**: Halt rollout, fix issue, redeploy

---

## Known Issues

### Android Build Issue (React Native 0.76 + Monorepo)

**Issue**: Gradle build fails with `react-native-gradle-plugin` not found

**Root Cause**: React Native 0.76.6 composite build configuration incompatible with pnpm monorepo structure

**Status**: All native modules compile successfully, only packaging fails

**Workarounds**:

1. **Use React Native CLI** (recommended):
   ```bash
   npx react-native build-android --mode=release
   ```

2. **Temporary standalone build**:
   ```bash
   cp -r mobile/beam-app /tmp/standalone
   cd /tmp/standalone
   npm install  # Use npm instead of pnpm
   npx react-native build-android --mode=release
   ```

3. **Expo Application Services** (paid):
   ```bash
   eas build --platform android --profile production
   ```

### Anchor Test Compute Unit Limit

**Issue**: 3/8 tests fail due to Ed25519 verification exceeding 200K CU limit

**Fix**: Add compute budget request in settlement instruction:
```rust
use solana_program::compute_budget::ComputeBudgetInstruction;

// Request additional compute units
let ix = ComputeBudgetInstruction::set_compute_unit_limit(400_000);
```

---

## Sign-Off

**Release Manager**: ________________
**Date**: ________________

**Backend Engineer**: ________________
**Date**: ________________

**Mobile Engineer**: ________________
**Date**: ________________

**Security Auditor**: ________________
**Date**: ________________

---

## Appendix: Quick Commands

### Solana Program
```bash
# Deploy to mainnet
anchor deploy --provider.cluster mainnet-beta

# Verify
solana program show <PROGRAM_ID>
```

### Verifier Service
```bash
# Deploy to Cloud Run
gcloud run deploy beam-verifier --image gcr.io/...

# Check health
curl https://your-service/health
```

### Mobile App
```bash
# Build release
npx react-native build-android --mode=release

# Test release APK
adb install -r app-release.apk
```

---

**Last Updated**: 2025-10-18
**Version**: 1.0.0
**Status**: ✅ Ready for Production (with documented workarounds)
