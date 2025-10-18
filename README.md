# Beam - Offline-First P2P Payments on Solana

> **Secure payments when internet fails.** Built for the 296 internet shutdowns that happened in 2024.

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana)](https://explorer.solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.31.1-663399)](https://anchor-lang.com)
[![React Native](https://img.shields.io/badge/React_Native-0.76.6-61DAFB?logo=react)](https://reactnative.dev)

## Table of Contents

- [The Problem](#-the-problem)
- [The Solution](#-the-solution)
- [Key Features](#-key-features)
- [Technical Stack](#-technical-stack)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
- [Usage Flow](#-usage-flow)
- [Security Model](#-security-model)
- [Implementation Status](#-implementation-status)
- [Documentation](#-documentation)
- [Impact](#-impact)
- [Hackathon Highlights](#-hackathon-highlights)

## 🎯 The Problem

**296 internet shutdowns in 2024** caused **$7.69 billion** in economic damage worldwide.

During shutdowns, natural disasters, protests, or network outages:
- ❌ Traditional payment apps stop working
- ❌ Merchants can't accept payments
- ❌ People can't spend their money
- ❌ Economic activity grinds to a halt

**Examples:**
- **Iran & Iraq**: Complete internet blackouts during protests
- **Syria**: War-related infrastructure damage
- **India**: 116 shutdowns during exams and protests
- **Natural disasters**: Network outages lasting days

## ✨ The Solution

**Beam** enables secure peer-to-peer payments **completely offline** using:

1. **Pre-funded Escrow** - Customer deposits USDC in Solana escrow PDA
2. **Offline Bundles** - Payment bundles created and signed without internet
3. **Dual Signatures** - Both customer and merchant sign for cryptographic proof
4. **Settlement** - When online, bundles submit to Solana with replay protection

### How It Works

```
┌─────────────────────┐
│   OFFLINE PHASE     │
│  (No Internet)      │
└─────────────────────┘
         │
         ▼
Customer Creates Payment Bundle
    ├─ Amount, merchant, nonce
    ├─ Signs with Ed25519
    └─ Stores locally
         │
         ▼
Merchant Receives Bundle (BLE/QR)
    ├─ Verifies customer signature
    ├─ Co-signs bundle
    └─ Both have cryptographic proof
         │
┌─────────────────────┐
│   ONLINE PHASE      │
│  (Internet Back)    │
└─────────────────────┘
         │
         ▼
Customer Submits to Solana
    ├─ Verifies both signatures
    ├─ Checks nonce (replay protection)
    ├─ Transfers from escrow → merchant
    └─ Transaction confirmed on-chain
```

## 🚀 Key Features

### ✅ Fully Implemented

- **Offline Payment Creation** - Works without any internet connection
- **Escrow-Based Trust** - Pre-funded escrow solves merchant risk
- **Ed25519 Dual Signatures** - Cryptographic proof for both parties
- **Nonce Replay Protection** - Prevents double-spending attacks
- **Persistent Storage** - Bundles saved locally, survive app restart
- **Solana Integration** - Real Anchor program, token transfers
- **Secure Wallet** - React Native Keychain with biometric protection

### 🔧 Technical Stack

**Blockchain:**
- Solana blockchain (devnet)
- Anchor framework 0.31.1
- SPL Token (USDC)
- Program Derived Addresses (PDAs)

**Mobile App:**
- React Native 0.76.6
- TypeScript 5.3.3
- @coral-xyz/anchor for Solana calls
- @noble/ed25519 for cryptography
- AsyncStorage for persistence

**Security:**
- Ed25519 signatures
- Canonical serialization (deterministic)
- Nonce-based replay protection
- Secure keychain storage

## 📁 Project Structure

```
Beam/
├── program/                    # Anchor Solana program
│   ├── programs/program/
│   │   └── src/
│   │       ├── lib.rs         # Main program logic
│   │       ├── state.rs       # Account structures
│   │       └── attestation.rs # Attestation verification
│   └── tests/
│       └── simple-test.ts     # Program tests
│
├── mobile/
│   ├── shared/                # Shared TypeScript library
│   │   ├── src/
│   │   │   ├── bundle.ts      # Bundle creation & signing
│   │   │   ├── crypto.ts      # Ed25519 utilities
│   │   │   ├── types.ts       # TypeScript types
│   │   │   └── qr.ts          # QR code generation
│   │   └── package.json
│   │
│   └── beam-app/              # React Native app
│       ├── src/
│       │   ├── screens/       # UI screens
│       │   ├── services/      # Business logic
│       │   ├── storage/       # Persistent storage
│       │   ├── native/        # Native bridges
│       │   ├── solana/        # Blockchain integration
│       │   └── config/        # Configuration
│       └── android/           # Android native code
│
└── verifier/                  # Attestation verifier service
    └── src/
        ├── index.ts           # Express server
        └── attestation/       # Verification logic
```

## 🏃 Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- Rust & Anchor CLI 0.31+
- Solana CLI 1.18+
- Android SDK (for mobile development)

### Installation

```bash
# 1. Install all dependencies
pnpm install

# 2. Build Solana program
cd program
anchor build
anchor deploy --provider.cluster devnet

# 3. Build shared library
cd ../mobile/shared
pnpm build

# 4. Start verifier service
cd ../../verifier
cp .env.example .env
pnpm dev

# 5. Run mobile app
cd ../mobile/beam-app
pnpm android
```

### Quick Commands

```bash
# Development
pnpm dev:verifier        # Start verifier in dev mode
pnpm dev:validator       # Start local Solana validator
pnpm build:program       # Build Anchor program
pnpm test:all            # Run all tests

# Testing
cd program && anchor test              # Test Solana program
cd mobile/shared && pnpm test          # Test shared library
cd verifier && pnpm test               # Test verifier
```

For detailed setup instructions, see [SETUP.md](./SETUP.md).

## 🎯 Usage Flow

### For Customers

1. **Setup** (One-time)
   - Create wallet
   - Fund with devnet SOL & USDC
   - Initialize escrow (e.g., 100 USDC)

2. **Make Offline Payment**
   - Enter merchant QR or connect via BLE
   - Create payment bundle
   - Sign with your private key
   - Bundle stored locally

3. **Settlement** (When online)
   - App detects internet
   - Click "Settle All"
   - Bundles submitted to Solana
   - Tokens transferred from escrow

### For Merchants

1. **Setup** (One-time)
   - Create wallet
   - Share your public key/QR

2. **Receive Payment**
   - Generate payment QR
   - Customer scans/connects
   - Receive signed bundle
   - Co-sign to acknowledge
   - Both parties have proof

3. **Automatic Settlement**
   - Customer settles when online
   - You receive USDC in your wallet
   - No action needed

## 🔐 Security Model

### Escrow Trust

- Customer pre-funds escrow on Solana
- Escrow PDA holds USDC tokens
- Merchant guaranteed payment exists
- No chargeback risk

### Dual Signatures

```typescript
// Customer signs payment
const payerSig = ed25519.sign(bundleHash, payerPrivateKey);

// Merchant signs acknowledgment
const merchantSig = ed25519.sign(bundleHash, merchantPrivateKey);

// Both required for proof
bundle = { ...data, payerSig, merchantSig };
```

### Replay Protection

```rust
// On-chain validation
require!(
    payer_nonce > escrow.last_nonce,
    BeamError::InvalidNonce
);

// Prevents reusing old bundles
escrow.last_nonce = payer_nonce;
```

## 📊 Implementation Status

### ✅ Fully Implemented

**Core Features:**
- ✅ Offline payment bundle creation and signing
- ✅ Escrow-based trust model with PDAs
- ✅ Ed25519 dual-signature verification
- ✅ Nonce-based replay protection
- ✅ Persistent local bundle storage
- ✅ Automatic settlement queue
- ✅ Solana mainnet-ready program

**Security:**
- ✅ Play Integrity API attestation
- ✅ Device attestation verification
- ✅ Verifier proof generation
- ✅ On-chain signature verification
- ✅ Fraud detection system
- ✅ Hardware-backed key storage (Android KeyStore)

**Mobile App:**
- ✅ Wallet creation and management
- ✅ Escrow initialization and funding
- ✅ Customer payment flow
- ✅ Merchant receipt flow
- ✅ Settlement service integration
- ✅ QR code payment exchange
- ✅ Biometric authentication

**Infrastructure:**
- ✅ Verifier service (Node.js/Express)
- ✅ Shared TypeScript library
- ✅ Comprehensive test suites
- ✅ Development workflow

### 🔨 In Progress

- BLE payment exchange (basic implementation done, needs testing)
- QR code scanning (mockup ready, camera integration pending)
- iOS app support (Android-first, iOS planned)

### 📅 Future Enhancements

- Real-time price feeds (Pyth integration)
- Multi-currency support
- Merchant dashboard web app
- Advanced fraud detection ML models
- iOS production release

## 🎬 Demo

### Quick Demo Flow

1. **Setup** - Create wallet & initialize escrow with USDC
2. **Offline Payment** - Create $10 payment bundle without internet
3. **Exchange** - Transfer via QR code with dual signatures
4. **Settlement** - Submit to Solana when online
5. **Verification** - View transaction on Solana Explorer

For detailed demo script, see [DEMO_WALKTHROUGH.md](./DEMO_WALKTHROUGH.md).

## 📈 Impact

**Target Users:**
- 1.3B people affected by internet shutdowns
- Merchants in conflict zones
- Remote areas with poor connectivity
- Disaster-affected regions

**Market Size:**
- $7.69B economic loss annually
- 296 shutdowns in 2024 alone
- Growing trend of government shutdowns

## 🏆 Hackathon Highlights

**Innovation:**
- First offline-first payment system on Solana
- Escrow-based trust model
- Dual-signature protocol for offline proof

**Technical Excellence:**
- Production Anchor program
- Real cryptography (Ed25519)
- Persistent local storage
- Solana token integration

**Real-World Impact:**
- Solves actual $7.69B problem
- 296 shutdowns = real user need
- War zones, disasters, protests

## 📚 Documentation

### Core Documentation

- **[SETUP.md](./SETUP.md)** - Complete setup and installation guide
  - Prerequisites and dependencies
  - Workspace installation
  - Building all components
  - Running tests
  - Development workflow
  - Troubleshooting

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture and design
  - Overall system architecture
  - Offline payment flow
  - Escrow and PDA design
  - Attestation flow
  - Settlement process
  - Security model
  - Cryptographic design

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Production deployment guide
  - Anchor program deployment (devnet/mainnet)
  - Verifier service deployment (Cloud Run, Railway, VPS)
  - Android app release build and signing
  - Google Play Store submission
  - Environment configuration
  - Monitoring and maintenance

### Mobile App Documentation

- **[PLAY_INTEGRITY_IMPLEMENTATION.md](./mobile/beam-app/PLAY_INTEGRITY_IMPLEMENTATION.md)** - Play Integrity API implementation
  - Complete implementation guide
  - Configuration instructions
  - Testing procedures
  - Troubleshooting

- **[ATTESTATION_QUICK_REFERENCE.md](./mobile/beam-app/ATTESTATION_QUICK_REFERENCE.md)** - Quick reference guide
  - Quick start commands
  - Configuration checklist
  - Common commands
  - Troubleshooting tips

### Additional Resources

- [DEMO_WALKTHROUGH.md](./DEMO_WALKTHROUGH.md) - Complete demo script
- [PRODUCTION_STATUS.md](./PRODUCTION_STATUS.md) - Implementation status
- [PROGRESS.md](./PROGRESS.md) - Development progress
- [STATUS.md](./STATUS.md) - Technical status

## 🤝 Team

Built for **Colosseum Cypherpunk 2025** hackathon.

## 📄 License

ISC

---

**Beam** - When the internet fails, payments don't have to.
