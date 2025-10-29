# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Last Updated**: 2025-01-27
**Status**: Colosseum Cypherpunk Hackathon 2025 Submission Preparation

---

## 🚨 STRICT RULES - READ FIRST

**RULE #1: NO DOCUMENTATION GENERATION UNLESS EXPLICITLY REQUESTED**
- NEVER create analysis reports, documentation files, or summary documents unless the user explicitly asks
- Just do the work and provide SHORT verbal summaries
- Save context and time - no verbose explanations
- If user says "analyze the codebase", just analyze and give quick bullet points
- User will tell you if they need detailed reports

**RULE #2: CONCISE COMMUNICATION**
- Keep responses SHORT and ACTIONABLE
- Focus on: What's the issue? What's the fix? Done.
- No lengthy explanations unless asked

---

## Project Overview

**BEAM** is a censorship-resistant, offline-first cryptocurrency payment solution built on Solana Mobile Stack. It enables peer-to-peer USDC payments via BLE (Bluetooth Low Energy) when internet is unavailable, with on-chain settlement when connectivity resumes.

**Core Value Proposition**: Send crypto payments during internet shutdowns, in remote areas, or under financial censorship using only Bluetooth.

**Core Architecture:**
- **Mobile App** (React Native + Kotlin): Customer and merchant UIs with BLE P2P networking
- **Verifier Service** (Node.js/Express on Vercel): Hardware attestation and bundle validation
- **Solana Program** (Anchor/Rust): On-chain settlement with attestation verification

---

## Repository Structure

```
/Users/vijaygopalb/Beam/
├── mobile/beam-app/         # React Native Android app (React Native 0.76.6)
│   ├── src/
│   │   ├── screens/         # UI screens (Customer, Merchant, Setup, Funding)
│   │   ├── services/        # Business logic (Settlement, BLE, Attestation)
│   │   ├── solana/          # Blockchain client (BeamProgram.ts)
│   │   ├── wallet/          # Wallet management (Ed25519 signing)
│   │   ├── storage/         # Data persistence (bundles, nonces)
│   │   ├── components/      # Reusable UI components
│   │   ├── config/          # Network configuration
│   │   └── native/          # Native bridge (TypeScript side)
│   └── android/             # Native Android code (Kotlin)
│       └── app/src/main/java/com/beam/app/modules/
│           ├── SecureStorageBridgeModule.kt  # Android Keystore integration
│           └── BLEPeripheralModule.kt        # BLE GATT server
├── verifier/                # Backend attestation service (Express + Vercel)
│   ├── src/
│   │   ├── attestation/     # Play Integrity verification
│   │   ├── relay/           # Bundle relay storage
│   │   ├── usdc/            # Token minting service (devnet)
│   │   ├── routes/          # API endpoints
│   │   └── index.ts         # Express server (lazy loading)
│   ├── api/index.js         # Vercel serverless entry
│   └── vercel.json          # Vercel deployment config
├── program/                 # Solana on-chain program (Anchor/Rust)
│   ├── programs/program/src/
│   │   ├── lib.rs           # Main instruction handlers (614 lines)
│   │   ├── state.rs         # Account structures (49 lines)
│   │   └── attestation.rs   # Ed25519 signature verification (118 lines)
│   ├── tests/               # Anchor integration tests
│   │   ├── beam.ts          # Full settlement flow tests (372 lines)
│   │   └── attestation-helper.ts  # Test utilities (102 lines)
│   └── Anchor.toml          # Anchor configuration
├── scripts/                 # Utility scripts (TypeScript)
│   ├── check-escrow-real.ts       # Check escrow balance
│   ├── mint-usdc.ts               # Mint test USDC tokens
│   ├── create-usdc-mint.ts        # Create USDC mint
│   └── usdc-mint-config.json      # Mint configuration
├── docs/                    # Documentation
│   └── DEPLOYMENT.md        # Deployment guide
├── skills.md                # Required skills and technologies
└── CLAUDE.md                # This file (project guidance)
```

---

## Current Status & Priorities

### 🚨 CRITICAL ISSUES (Must Fix Before Hackathon Submission)

1. **Hash Function Mismatch** (BLOCKING)
   - **Location**: `program/programs/program/src/attestation.rs:105`
   - **Problem**: Rust uses SHA512 (hashv), tests use SHA256
   - **Impact**: Attestation verification will fail in production
   - **Fix**: Standardize on SHA256 or SHA512 across program, tests, and verifier

2. **Hardcoded Verifier Key** (HIGH SECURITY RISK)
   - **Location**: `program/programs/program/src/attestation.rs:7-9`
   - **Problem**: Test key hardcoded in program, cannot rotate without upgrade
   - **Impact**: Security vulnerability, no key rotation mechanism
   - **Fix**: Implement PDA-based verifier authority or governance

3. **Verifier Service Security** (CRITICAL)
   - **Location**: `verifier/src/index.ts`, `verifier/src/env.ts`
   - **Problems**:
     - No authentication on any endpoints
     - Default signing key hardcoded in source
     - CORS allows all origins
     - No rate limiting enforced
     - In-memory relay storage (data loss on restart)
   - **Fix**: Add API key auth, implement rate limiting, add database

4. **Hardcoded Local IP** (CONFIG)
   - **Location**: `mobile/beam-app/src/config/index.ts:158`
   - **Problem**: Verifier URL defaults to `http://192.168.29.13:3000`
   - **Impact**: Production builds will fail
   - **Fix**: Default to `https://beam-verifier.vercel.app`

5. **Incomplete Key Attestation** (SECURITY)
   - **Location**: `verifier/src/attestation/index.ts:141-177`
   - **Problem**: No certificate chain validation, accepts any chain
   - **Impact**: Fake attestations can pass
   - **Fix**: Implement proper X.509 validation

---

## Common Commands

### Mobile App (React Native)

**Location:** `/Users/vijaygopalb/Beam/mobile/beam-app`

```bash
# Start Metro bundler
pnpm start

# Build & run on Android (requires device/emulator)
pnpm android

# Type checking (currently has ~37 known errors, non-blocking)
pnpm exec tsc --noEmit

# Lint
pnpm lint

# Build Android APK
cd android
./gradlew assembleDebug              # Debug build
./gradlew assembleRelease            # Release build
./gradlew compileDebugKotlin         # Kotlin compilation only

# Clean builds
pnpm clean:android                    # Android only
cd android && ./gradlew clean

# Install APK on connected device
cd android && ./gradlew installDebug

# View logs
adb logcat -s "ReactNativeJS:I"

# List connected devices
adb devices

# Clear app data
adb shell pm clear com.beam.app
```

### Verifier Service

**Location:** `/Users/vijaygopalb/Beam/verifier`

```bash
# Local development (watch mode with auto-reload)
pnpm dev

# Build TypeScript
pnpm build

# Start production server (requires build first)
pnpm start

# Deploy to Vercel
vercel --prod

# Set environment variable
vercel env add VERIFIER_SIGNING_KEY production

# View deployment logs
vercel logs

# Test health endpoint
curl http://localhost:3000/health
# or
curl https://beam-verifier.vercel.app/health
```

### Solana Program (Anchor)

**Location:** `/Users/vijaygopalb/Beam/program`

```bash
# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test

# Run tests with logs
anchor test -- --nocapture

# Show program info
solana program show 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi

# Program ID: 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi (Devnet)
```

### Utility Scripts

```bash
# Check escrow balance for an address
ts-node scripts/check-escrow-real.ts

# Mint test USDC to an address
ts-node scripts/mint-usdc.ts <address> <amount>

# Create a new USDC mint
ts-node scripts/create-usdc-mint.ts

# Fund wallet with SOL (devnet)
ts-node scripts/fund-wallet.ts <address>
```

---

## Key Architecture Concepts

### Offline Payment Flow

1. **Bundle Creation** (Offline)
   - Customer creates unsigned payment bundle
   - Signs with Ed25519 (hardware-backed via Android Keystore)
   - Stores in local secure storage

2. **BLE Transmission** (Offline)
   - Customer transmits signed bundle to merchant via BLE
   - Uses chunking for large payloads (>512 bytes)
   - ACK/NACK protocol ensures reliable delivery
   - Merchant stores received bundle

3. **Attestation Fetching** (Requires Internet)
   - Both parties request hardware attestation from verifier
   - Android generates Play Integrity token
   - Verifier validates token and signs attestation envelope
   - Attestation stored with bundle

4. **Bundle Relay** (Optional, Requires Internet)
   - Devices upload bundles to relay service
   - Enables settlement by either party
   - 7-day TTL, 100 bundles per pubkey limit

5. **Settlement** (Requires Internet)
   - Either party submits bundle + attestations to Solana program
   - Program verifies:
     - Attestation root computation matches
     - Ed25519 signature from verifier
     - Nonce > last_nonce (replay protection)
     - Bundle hash not in recent history (duplicate detection)
     - Sufficient escrow balance
   - Transfers USDC from escrow to merchant atomically
   - Records in bundle history

### BLE Protocol Details

**Configuration:**
- **Service UUID**: `00006265-0000-1000-8000-00805f9b34fb`
- **Bundle Characteristic**: `000062b1-0000-1000-8000-00805f9b34fb` (write)
- **Response Characteristic**: `000062b2-0000-1000-8000-00805f9b34fb` (notify)
- **MTU**: Typically 512 bytes (device-dependent)
- **Max Payload**: 8KB (before chunking)

**Roles:**
- **Customer**: BLE Central (scans and connects)
- **Merchant**: BLE Peripheral (advertises GATT server)

**Transmission:**
1. Merchant advertises with "Beam-" prefix
2. Customer scans and connects
3. Customer writes bundle to Bundle Characteristic
4. Merchant reads bundle, validates signatures
5. Merchant sends ACK on Response Characteristic
6. Customer disconnects after confirmation

### Attestation System

**Attestation Envelope Structure:**
```typescript
{
  bundleId: string;
  timestamp: number;              // Unix timestamp
  nonce: Uint8Array;              // 32-byte random nonce
  attestationReport: Uint8Array;  // JSON of device validation data
  signature: Uint8Array;          // Ed25519 signature (64 bytes)
  certificateChain: Uint8Array[]; // Verifier public key
  deviceInfo: {
    model: string;
    osVersion: string;
    securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  };
}
```

**Attestation Root Computation** (Must match program):
```
Prefix: "beam.attestation.v1"
Components (concatenated):
  1. bundle_id (UTF-8)
  2. payer_pubkey (32 bytes)
  3. merchant_pubkey (32 bytes)
  4. amount (u64 little-endian)
  5. bundle_nonce (u64 little-endian)
  6. role byte (0=payer, 1=merchant)
  7. attestation_nonce (32 bytes)
  8. attestation_timestamp (i64 little-endian)

Hash: SHA256 or SHA512 (MUST MATCH PROGRAM)
Signature: Ed25519 (verifier private key)
```

**⚠️ CRITICAL**: Hash function must match between:
- Rust program (`attestation.rs`)
- Test helper (`attestation-helper.ts`)
- Verifier service (`attestation/index.ts`)

### Native Modules (Kotlin)

**SecureStorageBridgeModule.kt:**
- Android Keystore integration (hardware-backed keys)
- Ed25519 keypair generation (32-byte seed)
- AES-GCM encryption (256-bit key)
- Signing with secure element (StrongBox/TEE when available)
- Biometric protection (optional)

**Key Operations:**
```kotlin
// Generate wallet keypair
ensureWalletKeypair() -> PublicKey (base64)

// Sign message with hardware key
signMessage(payload: ByteArray) -> Signature (base64)

// Encrypt/decrypt data
encryptData(plaintext: String) -> Ciphertext (base64)
decryptData(ciphertext: String) -> Plaintext
```

---

## Configuration

### Mobile App Config

**File:** `mobile/beam-app/src/config/index.ts`

**Key Settings:**
- `SOLANA_NETWORK`: devnet | mainnet-beta (from env)
- `BEAM_PROGRAM_ID`: `6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi` (Devnet)
- `USDC_MINT`: `CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N` (Devnet custom)
- `services.verifier`: Backend verifier URL

**⚠️ CRITICAL FIX NEEDED:**
```typescript
// Current (WRONG):
services: {
  verifier: process.env.VERIFIER_URL || 'http://192.168.29.13:3000', // Local IP!
}

// Should be (CORRECT):
services: {
  verifier: process.env.VERIFIER_URL || 'https://beam-verifier.vercel.app',
}
```

**Android BuildConfig:**
`mobile/beam-app/android/gradle.properties`:
```properties
VERIFIER_URL=https://beam-verifier.vercel.app
```

Override at build time:
```bash
./gradlew assembleRelease -PVERIFIER_URL=https://your-url.vercel.app
```

### Verifier Environment Variables

**File:** `verifier/.env` (local) or Vercel dashboard (production)

**Required for Production:**
- `VERIFIER_SIGNING_KEY`: 32-byte hex Ed25519 private key
- `GOOGLE_CLOUD_PROJECT_ID`: GCP project ID
- `GOOGLE_CLOUD_PROJECT_NUMBER`: GCP project number
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Service account credentials JSON
- `PLAY_INTEGRITY_API_KEY`: Google Play Integrity API key
- `SOLANA_RPC_URL`: Solana RPC endpoint
- `BEAM_PROGRAM_ID`: Deployed program address
- `USDC_MINT_ADDRESS`: USDC token mint
- `DEV_MODE`: false for production

**⚠️ SECURITY**: Never commit `.env` file to git. Use `.env.template` as reference.

See `verifier/.env.template` for complete list.

### Solana Network Config

**RPC Endpoints** (with fallbacks):
```typescript
devnet: [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
  'https://solana-devnet-rpc.allthatnode.com',
]
```

**Commitment Level**: `confirmed` (2/3 validator quorum)
**Timeout**: 30 seconds (network calls)
**Max Retries**: 3 attempts per RPC endpoint

---

## Critical Implementation Details

### Vercel Serverless Constraints

The verifier uses **lazy module loading** to avoid import-time crashes:

```typescript
// ❌ WRONG - loads at boot, crashes serverless
import { heavyModule } from './heavy-module';
app.post('/endpoint', async (req, res) => {
  await heavyModule(req.body);
});

// ✅ CORRECT - loads only when endpoint is hit
app.post('/endpoint', async (req, res) => {
  const { heavyModule } = await import('./heavy-module');
  await heavyModule(req.body);
});
```

**All Solana, attestation, and USDC modules use lazy imports** in `verifier/src/index.ts`.

### TypeScript Errors (Mobile App)

The mobile app currently has **~37 TypeScript compilation errors**. These are **non-blocking** because React Native uses Babel for transpilation, not tsc.

**Common Error Categories:**
- Missing type definitions (e.g., `tokens.neutral` color)
- Type mismatches in Solana/SPL Token APIs (v1.x → v2.x migration)
- Missing imports (e.g., `NetInfo`)
- Optional props on components

**To check:**
```bash
cd mobile/beam-app
pnpm exec tsc --noEmit
```

**Note**: App runs fine despite TypeScript errors. They should be fixed for maintainability but are not blocking.

### Android-Only Platform

This project uses **Solana Mobile Stack**, which is **Android-only**. There is **no iOS support**.

All native modules are Kotlin, and the app requires:
- Android SDK API 33+
- Android device with BLE capabilities
- For hardware attestation: Device with StrongBox or TEE secure element

---

## Testing

### Local Verifier Testing

```bash
cd verifier
pnpm build
pnpm start

# In another terminal - Health check
curl http://localhost:3000/health
# → {"status":"ok","devMode":true}

# Request attestation
curl -X POST http://localhost:3000/api/attestation/request \
  -H 'Content-Type: application/json' \
  -d '{
    "bundleId": "test-bundle-001",
    "deviceToken": "dev_test_token",
    "bundleHash": "abc123",
    "timestamp": 1729675200000,
    "deviceInfo": {
      "model": "Test Device",
      "osVersion": "14",
      "securityLevel": "TEE"
    }
  }'
```

### Production Verifier

```bash
# Health check
curl https://beam-verifier.vercel.app/health
# → {"status":"ok","devMode":false}

# Verify attestation
curl -X POST https://beam-verifier.vercel.app/verify-attestation \
  -H 'Content-Type: application/json' \
  -d @attestation-request.json
```

### Mobile App Testing

**Requires 2 physical Android devices:**
1. **Device A**: Merchant mode (creates payment request)
2. **Device B**: Customer mode (scans QR, pays via BLE)

**Test Flow:**
1. Merchant generates QR code for payment
2. Customer scans QR, confirms payment
3. BLE transmission (offline - turn off Wi-Fi/cellular!)
4. Both devices fetch attestations (when online)
5. Either party settles on Solana
6. Verify balances updated

### USDC Faucet (Devnet)

```bash
# Mint test USDC to an address
curl -X POST https://beam-verifier.vercel.app/test-usdc/mint \
  -H 'Content-Type: application/json' \
  -d '{"ownerAddress":"<SOLANA_ADDRESS>","amount":100}'

# Or use script
ts-node scripts/mint-usdc.ts <address> 100
```

---

## Deployment

### Verifier to Vercel

**Prerequisites:**
- Vercel CLI installed: `npm i -g vercel`
- Vercel account connected
- Environment variables configured

**Deploy:**
```bash
cd verifier
pnpm build
vercel --prod
```

**Set Environment Variables:**
```bash
vercel env add VERIFIER_SIGNING_KEY production
vercel env add GOOGLE_CLOUD_PROJECT_ID production
vercel env add PLAY_INTEGRITY_API_KEY production
# ... etc
```

**Verify Deployment:**
```bash
curl https://beam-verifier.vercel.app/health
```

### Android App

**Release Build:**
```bash
cd mobile/beam-app/android
./gradlew assembleRelease -PVERIFIER_URL=https://beam-verifier.vercel.app

# APK location:
# android/app/build/outputs/apk/release/app-release.apk
```

**Install on Device:**
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

**Note**: Release build requires signing config in `android/gradle.properties` or keystore setup.

---

## Important File References

### Mobile App (TypeScript/Kotlin)
- **Payment Creation**: `mobile/beam-app/src/services/AttestationService.ts` (260 lines)
- **BLE Networking**: `mobile/beam-app/src/services/BLEDirectService.ts` (832 lines)
- **Settlement**: `mobile/beam-app/src/services/SettlementService.ts` (420 lines)
- **Blockchain Client**: `mobile/beam-app/src/solana/BeamProgram.ts` (647 lines)
- **Customer UI**: `mobile/beam-app/src/screens/CustomerScreen.tsx` (1,432 lines)
- **Merchant UI**: `mobile/beam-app/src/screens/MerchantScreen.tsx` (977 lines)
- **Secure Keystore**: `mobile/beam-app/android/app/src/main/java/com/beam/app/modules/SecureStorageBridgeModule.kt` (~300 lines)

### Verifier Service (TypeScript)
- **Attestation Verification**: `verifier/src/attestation/index.ts` (299 lines)
- **Play Integrity**: `verifier/src/attestation/google.ts` (213 lines)
- **Bundle Relay**: `verifier/src/relay/index.ts` (324 lines)
- **USDC Minting**: `verifier/src/usdc/service.ts` (197 lines)
- **Express Server**: `verifier/src/index.ts` (173 lines)

### Solana Program (Rust)
- **Main Logic**: `program/programs/program/src/lib.rs` (614 lines)
- **Account Structures**: `program/programs/program/src/state.rs` (49 lines)
- **Attestation Verification**: `program/programs/program/src/attestation.rs` (118 lines)
- **Integration Tests**: `program/tests/beam.ts` (372 lines)

---

## Known Limitations

### Technical Limitations
- **Android-only** (no iOS, requires Solana Mobile Stack)
- **BLE range**: ~10-100 meters (line of sight)
- **BLE mesh**: Max 7 devices per network (Bluetooth spec)
- **Bundle size**: Limited to 4KB (chunked for BLE)
- **Attestation**: Requires internet connectivity to fetch
- **Play Integrity**: Only works on real devices (not emulators)
- **USDC mint authority**: On backend verifier (centralized)

### Security Limitations
- **Verifier centralization**: Single verifier service (SPOF)
- **Hardcoded verifier key**: No key rotation without program upgrade
- **Optional merchant attestation**: Payer can settle without merchant proof
- **Fraud reporting**: Any address can report fraud (DOS vector)
- **Certificate validation**: Key Attestation path incomplete

### UX Limitations
- **Offline limitations**: Bundle creation offline, settlement requires internet
- **Attestation delay**: 5-10 seconds to fetch from verifier
- **BLE pairing**: Manual device discovery and connection
- **Network status**: Users must manually trigger settlement

---

## Troubleshooting

### Escrow Balance Shows 0

**Root Causes:**
1. Escrow account doesn't exist yet (call `initializeEscrow()`)
2. RPC endpoint timeout (try fallback endpoints)
3. Hardcoded local IP in config (fix `config/index.ts:158`)
4. Network connectivity issue (check Wi-Fi/cellular)

**Debug Steps:**
```bash
# 1. Check if escrow account exists
ts-node scripts/check-escrow-real.ts

# 2. Test RPC connectivity
curl https://api.devnet.solana.com -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# 3. Initialize escrow if needed (in app)
const beamClient = new BeamProgramClient(rpcUrl, signer);
await beamClient.initializeEscrow(10_000_000); // 10 USDC
```

### BLE Connection Fails

**Root Causes:**
1. Bluetooth not enabled
2. Location permission not granted (Android requirement)
3. UUID mismatch
4. Device out of range

**Debug Steps:**
```bash
# Check Bluetooth status
adb shell settings get global bluetooth_on
# → 1 (enabled) or 0 (disabled)

# Check app permissions
adb shell dumpsys package com.beam.app | grep permission

# View BLE logs
adb logcat -s "ReactNativeJS:I" | grep BLE
```

### Attestation Verification Fails

**Root Causes:**
1. Hash function mismatch (SHA256 vs SHA512)
2. Incorrect verifier public key
3. Timestamp too old (>24 hours)
4. Invalid Play Integrity token

**Debug Steps:**
1. Check hash algorithm in `attestation.rs` vs `attestation-helper.ts`
2. Verify verifier public key matches in program
3. Check attestation timestamp: `Date.now() - attestation.timestamp < 86400000`
4. Test with dev mode attestation first

---

## Hackathon Submission Checklist

### Pre-Submission (Must Do)
- [ ] Fix hash function mismatch (SHA256 vs SHA512)
- [ ] Update verifier URL in `config/index.ts` (remove local IP)
- [ ] Add verifier authentication (API key or JWT)
- [ ] Implement rate limiting on verifier
- [ ] Add fraud reporting tests
- [ ] Create SECURITY.md documenting attestation flow
- [ ] Record 2-minute demo video (2 phones, offline BLE payment)
- [ ] Polish README with problem statement and demo GIF

### Demo Preparation
- [ ] Test on 2 physical Android devices
- [ ] Verify offline payment works (airplane mode)
- [ ] Confirm on-chain settlement succeeds
- [ ] Prepare slide deck (problem → solution → demo → impact)
- [ ] Practice 5-minute pitch

### Deployment
- [ ] Deploy verifier to Vercel with production config
- [ ] Verify health endpoint: `https://beam-verifier.vercel.app/health`
- [ ] Test USDC faucet endpoint
- [ ] Build release APK with production verifier URL
- [ ] Test end-to-end flow with production setup

---

## Additional Resources

### External Documentation
- **Solana Mobile Docs**: https://docs.solanamobile.com/
- **Anchor Book**: https://www.anchor-lang.com/docs
- **React Native**: https://reactnative.dev/docs/getting-started
- **Android Keystore**: https://developer.android.com/training/articles/keystore
- **Play Integrity**: https://developer.android.com/google/play/integrity

### Internal Documentation
- **Skills & Technologies**: `/Users/vijaygopalb/Beam/skills.md`
- **Deployment Guide**: `/Users/vijaygopalb/Beam/docs/DEPLOYMENT.md`
- **Environment Template**: `/Users/vijaygopalb/Beam/verifier/.env.template`

### Support
- **Colosseum Hackathon**: https://www.colosseum.com/cypherpunk
- **Solana Discord**: https://discord.gg/solana
- **GitHub Issues**: [Report bugs and feature requests]

---

## Quick Reference

### Key Constants
- **Program ID**: `6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi`
- **USDC Mint (Devnet)**: `CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N`
- **BLE Service UUID**: `00006265-0000-1000-8000-00805f9b34fb`
- **Verifier URL**: `https://beam-verifier.vercel.app`
- **Max Attestation Age**: 24 hours (86400 seconds)
- **Max Bundle History**: 32 entries
- **Max Recent Hashes**: 16 entries
- **USDC Decimals**: 6

### File Sizes (Lines of Code)
- **Mobile App**: ~18,300 lines TypeScript + Kotlin
- **Verifier Service**: ~2,400 lines TypeScript
- **Solana Program**: ~780 lines Rust
- **Total**: ~21,500 lines of code

---

**Last Updated**: 2025-01-27
**Maintainer**: BEAM Core Team
**Status**: Active Development - Hackathon Preparation
**Target**: Colosseum Cypherpunk Hackathon 2025 (DeFi Track)
