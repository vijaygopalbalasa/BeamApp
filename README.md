# BEAM - Censorship-Resistant Offline Cryptocurrency Payments

**BEAM** is a mobile-first, offline-capable cryptocurrency payment solution built on Solana Mobile Stack. It enables peer-to-peer USDC payments via BLE mesh networking when internet connectivity is unavailable, with guaranteed on-chain settlement when connectivity resumes.

## 🎯 Core Features

### Offline-First Architecture
- **BLE Mesh Networking**: Payments propagate through nearby devices when offline
- **Escrow-Based Security**: Funds locked in on-chain escrow accounts
- **Hardware Attestation**: Google Play Integrity verification for fraud prevention
- **Automatic Settlement**: Transactions settle on Solana blockchain when online

### Real-Time Balance Dashboard
- **Multi-Currency Display**: SOL, USDC, and Escrow balances
- **Live Updates**: Automatic balance refresh with RPC fallback
- **Connection Health**: Real-time network status monitoring

### Production-Ready Security
- **API Key Authentication**: SHA256-hashed Bearer token verification
- **Rate Limiting**: Per-endpoint DOS protection
- **Fraud Reporting**: 2x payment slashing for malicious actors
- **Nonce Replay Protection**: Prevents duplicate transaction submission

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BEAM Ecosystem                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐ │
│  │   Customer   │◄────►│   Merchant   │◄────►│ Verifier │ │
│  │  Mobile App  │ BLE  │  Mobile App  │ HTTPS│ Service  │ │
│  └──────┬───────┘      └──────┬───────┘      └────┬─────┘ │
│         │                     │                    │        │
│         └─────────────────────┴────────────────────┘        │
│                               │                             │
│                               ▼                             │
│                    ┌────────────────────┐                   │
│                    │  Solana Blockchain │                   │
│                    │  (Devnet/Mainnet)  │                   │
│                    └────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Overview

1. **Mobile App** (React Native 0.76.6)
   - Android-only (Solana Mobile Stack requirement)
   - Customer & Merchant dashboards
   - BLE peripheral/central modes
   - Hardware-backed Ed25519 signing (Android Keystore)

2. **Verifier Service** (Node.js/Express on Vercel)
   - Google Play Integrity API integration
   - Attestation envelope signing (Ed25519)
   - Bundle relay for offline transaction propagation
   - Test USDC faucet (devnet only)

3. **Solana Program** (Anchor 0.31.1/Rust)
   - Escrow account management
   - Attestation verification
   - Fraud reporting & slashing
   - Bundle settlement with nonce tracking

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**: 8.x or higher
- **Android SDK**: API 33+ (for mobile app)
- **Rust**: 1.75+ (for Solana program)
- **Anchor**: 0.31.1 (for Solana program)
- **Solana CLI**: 1.18+ (for deployment)

### Installation

```bash
# Clone repository
git clone https://github.com/vijaygopalbalasa/BeamApp.git
cd BeamApp

# Install dependencies
pnpm install

# Mobile app setup
cd mobile/beam-app
pnpm install

# Verifier service setup
cd ../../verifier
pnpm install

# Solana program setup
cd ../program
anchor build
```

### Running the Mobile App

```bash
cd mobile/beam-app

# Start Metro bundler
pnpm start

# In another terminal, build and run on Android device
pnpm android

# Or build APK manually
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Running the Verifier Service

```bash
cd verifier

# Local development
cp .env.template .env
# Edit .env with your configuration
pnpm dev

# Production build
pnpm build
pnpm start

# Deploy to Vercel
vercel --prod
```

### Deploying Solana Program

```bash
cd program

# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test
```

## 📱 Mobile App Usage

### Customer Flow

1. **Wallet Setup**: App generates Ed25519 keypair on first launch (Android Keystore)
2. **Fund Wallet**: Receive SOL/USDC via standard Solana transfers
3. **Initialize Escrow**: Lock USDC in escrow for offline payments
4. **Scan QR**: Scan merchant's payment request QR code
5. **Pay Offline**: Transaction propagates via BLE mesh network
6. **Auto-Settlement**: Payment settles on-chain when online

### Merchant Flow

1. **Create Payment Request**: Generate QR code with amount & merchant pubkey
2. **Display QR**: Show to customer for scanning
3. **Receive via BLE**: Accept offline payment bundle
4. **Verify Attestation**: Check hardware attestation validity
5. **Settle On-Chain**: Submit bundle to Solana when online

## 🔧 Configuration

### Mobile App

**File**: `mobile/beam-app/src/config/index.ts`

```typescript
export const Config = {
  solana: {
    network: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    commitment: 'confirmed',
  },
  program: {
    id: '6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi',
  },
  tokens: {
    usdc: {
      mint: 'CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N',
      decimals: 6,
    },
  },
  services: {
    verifier: 'https://beam-verifier.vercel.app',
    usdcFaucet: 'https://beam-verifier.vercel.app/test-usdc/mint',
  },
};
```

### Verifier Service

**File**: `verifier/.env`

```bash
# Solana Configuration
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
BEAM_PROGRAM_ID=6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi

# USDC Configuration
USDC_MINT_ADDRESS=CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N

# Google Play Integrity
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_PROJECT_NUMBER=123456789
PLAY_INTEGRITY_API_KEY=your-api-key

# Verifier Signing Key (Ed25519 private key, 32-byte hex)
VERIFIER_SIGNING_KEY=<64-char hex string>

# API Authentication (optional for production)
API_KEY_HASH=<sha256 hash of your API key>

# Development Mode
DEV_MODE=false
```

See `verifier/AUTH_SETUP.md` for detailed authentication setup.

## 🧪 Testing

### Mobile App Tests

```bash
cd mobile/beam-app
pnpm test
```

### Solana Program Tests

```bash
cd program
anchor test

# Run specific test
anchor test -- --grep "fraud reporting"
```

The test suite includes:
- ✅ Escrow initialization & funding
- ✅ Offline payment settlement
- ✅ Nonce replay protection
- ✅ Fraud reporting & slashing (11 test cases)
- ✅ Attestation verification
- ✅ Withdrawal validation

### Verifier Service Tests

```bash
cd verifier
pnpm test
```

## 📊 Current Status (Production)

### Deployed Components

| Component | Environment | Status | URL/Address |
|-----------|-------------|--------|-------------|
| Mobile App | Production | ✅ Live | APK available |
| Verifier Service | Vercel | ✅ Live | https://beam-verifier.vercel.app |
| Solana Program | Devnet | ✅ Deployed | `6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi` |
| USDC Mint | Devnet | ✅ Active | `CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N` |

### Health Checks

```bash
# Verifier health
curl https://beam-verifier.vercel.app/health
# Response: {"status":"ok","devMode":false}

# USDC faucet test
curl -X POST https://beam-verifier.vercel.app/test-usdc/mint \
  -H 'Content-Type: application/json' \
  -d '{"ownerAddress":"<SOLANA_ADDRESS>","amount":100}'

# Program info
solana program show 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi
```

## 🔐 Security Model

### Multi-Layer Security

1. **Hardware Attestation** (Google Play Integrity)
   - Verifies app integrity & device security
   - Detects rooted/modified devices
   - Prevents replay attacks with nonces

2. **Cryptographic Signatures**
   - Ed25519 signatures from Android Keystore
   - Verifier co-signs attestation envelopes
   - All transactions cryptographically verified

3. **On-Chain Protection**
   - Nonce replay prevention
   - Bundle hash duplicate detection
   - Fraud reporting with 2x slashing
   - Reputation scoring system

4. **Network Security**
   - API key authentication (SHA256 hashed)
   - Rate limiting (20 req/min on critical endpoints)
   - HTTPS/TLS for all verifier communication

### Threat Model

**Protected Against:**
- ✅ Nonce replay attacks
- ✅ Double-spending
- ✅ Fraudulent attestations
- ✅ Man-in-the-middle attacks
- ✅ DOS attacks (via rate limiting)

**Requires Trust:**
- ⚠️ Verifier service honesty (signing only valid attestations)
- ⚠️ Google Play Integrity API availability
- ⚠️ Solana network liveness for settlement

## 🏛️ Program Architecture

### Account Structures

**OfflineEscrowAccount** (PDA: `seeds=[b"escrow", owner]`)
```rust
pub struct OfflineEscrowAccount {
    pub owner: Pubkey,                    // Escrow owner
    pub escrow_token_account: Pubkey,     // Associated token account
    pub escrow_balance: u64,              // USDC balance (smallest units)
    pub last_nonce: u64,                  // Latest settled nonce
    pub reputation_score: u16,            // User reputation (0-65535)
    pub total_spent: u64,                 // Lifetime spending
    pub created_at: i64,                  // Unix timestamp
    pub bump: u8,                         // PDA bump seed
}
```

**NonceRegistry** (PDA: `seeds=[b"nonce", payer]`)
```rust
pub struct NonceRegistry {
    pub owner: Pubkey,                              // Registry owner
    pub last_nonce: u64,                            // Latest nonce (replay protection)
    pub recent_bundle_hashes: Vec<[u8; 32]>,       // Max 16 (duplicate detection)
    pub bundle_history: Vec<BundleRecord>,         // Max 32 (settlement history)
    pub fraud_records: Vec<FraudRecord>,           // Max 16 (fraud evidence)
    pub bump: u8,                                  // PDA bump seed
}
```

### Instructions

1. **initialize_escrow**: Create escrow + optional initial deposit
2. **initialize_nonce_registry**: Create nonce tracking account
3. **fund_escrow**: Add USDC to escrow balance
4. **settle_offline_payment**: Verify attestation + transfer to merchant
5. **report_fraudulent_bundle**: Submit conflicting evidence (2x slashing)
6. **withdraw_escrow**: Withdraw unused funds

## 🛠️ Development

### Project Structure

```
beam/
├── mobile/beam-app/              # React Native mobile app
│   ├── android/                  # Android native code
│   ├── src/
│   │   ├── screens/              # UI screens
│   │   ├── services/             # Business logic
│   │   ├── solana/               # Blockchain integration
│   │   ├── wallet/               # Wallet management
│   │   └── config/               # Configuration
│   └── package.json
├── verifier/                     # Backend attestation service
│   ├── src/
│   │   ├── attestation/          # Play Integrity verification
│   │   ├── middleware/           # Auth & rate limiting
│   │   ├── relay/                # Bundle relay service
│   │   └── usdc/                 # Test USDC faucet
│   ├── api/                      # Vercel serverless functions
│   └── vercel.json
├── program/                      # Solana on-chain program
│   ├── programs/program/src/     # Rust source
│   │   ├── lib.rs                # Program entry point
│   │   ├── attestation.rs        # Attestation verification
│   │   └── state.rs              # Account structures
│   ├── tests/                    # Integration tests
│   └── Anchor.toml
└── README.md                     # This file
```

### Key Technologies

- **Mobile**: React Native 0.76.6, TypeScript, @solana/web3.js
- **Native**: Kotlin, Android Keystore, BLE GATT
- **Backend**: Node.js 20, Express, Vercel Serverless
- **Blockchain**: Solana, Anchor 0.31.1, Rust 1.75
- **Security**: Ed25519, SHA256, Google Play Integrity

## 📈 Performance

### Benchmarks

| Operation | Latency | Notes |
|-----------|---------|-------|
| Balance Fetch | ~1-2s | With RPC fallback |
| BLE Payment | ~2-5s | Local mesh, no internet |
| On-Chain Settlement | ~5-15s | Depends on Solana congestion |
| Attestation Fetch | ~1-3s | Verifier round-trip |

### Scalability

- **BLE Mesh**: Up to 7 devices per network
- **Bundle Size**: Max 4KB (chunked for BLE)
- **Escrow Balance**: u64 max (~18.4M SOL)
- **Bundle History**: 32 entries per user (circular buffer)

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Workflow

```bash
# Make changes
git checkout -b feature/my-feature

# Test thoroughly
cd mobile/beam-app && pnpm test
cd ../../program && anchor test

# Commit with clear message
git commit -m "Add feature: description"

# Push and create PR
git push origin feature/my-feature
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Links

- **Repository**: https://github.com/vijaygopalbalasa/BeamApp
- **Verifier Service**: https://beam-verifier.vercel.app
- **Program Explorer**: https://explorer.solana.com/address/6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi?cluster=devnet

## 👥 Team

Built with ❤️ by Vijaygopal B

## 📧 Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Contact: vijaygopalb@example.com

---

**Note**: This project is currently in active development. The devnet deployment is for testing purposes only. Do not use real funds.
