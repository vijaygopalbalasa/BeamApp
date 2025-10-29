# BEAM Project Skills & Technologies

This document outlines the technical skills, tools, and knowledge required to work on the BEAM project effectively.

---

## Core Technologies

### 1. Mobile Development
- **React Native (0.76.6)** - Primary mobile framework
- **TypeScript** - Type-safe JavaScript for mobile app
- **Kotlin** - Native Android modules (secure storage, BLE)
- **Android SDK** - Platform-specific functionality
- **Solana Mobile Stack** - Mobile-first Solana integration
- **Android Keystore** - Hardware-backed cryptography

### 2. Blockchain & Cryptography
- **Solana** - Layer 1 blockchain (Devnet/Mainnet-beta)
- **Anchor Framework (0.31.1)** - Solana program development
- **Rust** - Solana program language
- **@solana/web3.js (1.98.4)** - Solana JavaScript SDK
- **@solana/spl-token (0.4.9)** - Token program interactions
- **Ed25519** - Digital signature algorithm
- **SHA256/SHA512** - Cryptographic hash functions
- **@noble/curves & @noble/hashes** - Cryptographic primitives

### 3. Backend Services
- **Node.js** - Backend runtime
- **Express.js** - Web framework for verifier service
- **TypeScript** - Type-safe backend code
- **Vercel** - Serverless deployment platform
- **Google Play Integrity API** - Hardware attestation
- **JWT/JWS** - Token verification

### 4. BLE & Networking
- **Bluetooth Low Energy (BLE)** - P2P communication
- **GATT Protocol** - BLE service/characteristic model
- **react-native-ble-plx** - BLE library
- **Mesh Networking** - Multi-hop transmission
- **QR Codes** - Payment request encoding

---

## Required Skills by Role

### Mobile Developer
**Must Have:**
- React Native development (hooks, navigation, state management)
- TypeScript proficiency (types, interfaces, generics)
- Kotlin for Android native modules
- Android SDK (Activities, Services, BLE)
- Cryptography basics (signing, verification)
- Async/await patterns
- Storage (AsyncStorage, SharedPreferences)

**Nice to Have:**
- React Navigation
- Native bridge development
- Hardware security (Keystore, TEE, StrongBox)
- Performance optimization
- UI/UX design (design tokens, accessibility)

### Blockchain Developer
**Must Have:**
- Solana architecture (accounts, PDAs, CPIs)
- Anchor framework (programs, instructions, contexts)
- Rust programming (ownership, lifetimes, error handling)
- Token programs (SPL Token, Associated Token Accounts)
- Cryptographic signatures (Ed25519)
- Transaction construction
- Account deserialization

**Nice to Have:**
- Solana security best practices (reentrancy, overflow protection)
- Program upgrades and governance
- Metaplex standards
- Solana Mobile Stack specifics
- IDL generation and client integration

### Backend Developer
**Must Have:**
- Node.js and Express.js
- TypeScript
- RESTful API design
- Authentication/authorization
- Rate limiting
- Error handling
- Environment configuration
- Serverless architecture (Vercel/AWS Lambda)

**Nice to Have:**
- Database design (PostgreSQL, Redis)
- Microservices architecture
- API versioning
- Monitoring and logging (Sentry, Datadog)
- DevOps (CI/CD, Docker)

### Security Engineer
**Must Have:**
- Cryptographic protocols (signing, verification, hashing)
- Hardware attestation (Play Integrity, Key Attestation)
- X.509 certificates
- Public key infrastructure (PKI)
- Threat modeling
- Secure key management
- OWASP Top 10

**Nice to Have:**
- Penetration testing
- Security auditing
- Compliance (SOC 2, PCI DSS)
- Zero-knowledge proofs
- Secure enclaves (TEE, StrongBox)

---

## Development Tools

### IDEs & Editors
- **Visual Studio Code** - Primary editor
  - Extensions: ESLint, Prettier, Rust Analyzer, Solana/Anchor
- **Android Studio** - Native Android development
- **IntelliJ IDEA** - Kotlin development

### CLI Tools
- **Anchor CLI** - Solana program development
  - `anchor build` - Compile Rust program
  - `anchor test` - Run integration tests
  - `anchor deploy` - Deploy to network
- **Solana CLI** - Blockchain interactions
  - `solana program show` - Inspect program
  - `solana account` - View account data
  - `solana airdrop` - Request SOL (devnet)
- **React Native CLI**
  - `npx react-native run-android` - Run on device
  - `npx react-native start` - Start Metro bundler
- **pnpm** - Package manager (faster than npm/yarn)

### Testing Tools
- **Jest** - JavaScript testing framework
- **Mocha/Chai** - Anchor test framework
- **ts-node** - Execute TypeScript directly
- **React Native Testing Library** - Component testing

### Debugging Tools
- **Chrome DevTools** - JavaScript debugging
- **React Native Debugger** - Enhanced debugging
- **Flipper** - Mobile debugging (network, logs, storage)
- **adb (Android Debug Bridge)** - Device management
  - `adb logcat` - View device logs
  - `adb shell` - Execute device commands
  - `adb devices` - List connected devices
- **Solana Explorer** - Transaction inspection
- **Anchor Test Validator** - Local Solana cluster

---

## Key Concepts to Understand

### Blockchain
- **Program Derived Addresses (PDAs)** - Deterministic account generation
- **Cross-Program Invocation (CPI)** - Calling other programs
- **Nonce Replay Protection** - Prevent duplicate transactions
- **Escrow Accounts** - Holding funds securely
- **Token Accounts** - SPL token storage
- **Transaction Atomicity** - All-or-nothing execution
- **Rent-Exempt Accounts** - Permanent storage
- **Checked Arithmetic** - Overflow/underflow prevention

### Mobile Security
- **Hardware-Backed Keys** - Keystore, TEE, StrongBox
- **Biometric Authentication** - Fingerprint, face unlock
- **Secure Storage** - Encrypted SharedPreferences
- **Certificate Pinning** - Prevent MITM attacks
- **Root Detection** - Prevent compromised devices

### Attestation
- **Hardware Attestation** - Device integrity verification
- **Play Integrity API** - Google's attestation service
- **Key Attestation** - Certificate chain validation
- **Attestation Root** - Cryptographic binding of transaction data
- **Verifier Signature** - Trusted third-party validation

### BLE & Mesh
- **GATT Services** - BLE service structure
- **Characteristics** - Data read/write endpoints
- **MTU (Maximum Transmission Unit)** - Packet size limit (512 bytes typical)
- **Chunking** - Splitting large payloads
- **ACK/NACK Protocol** - Reliable transmission
- **Device Discovery** - Scanning and advertising
- **Peripheral vs Central** - BLE roles

### Offline-First Architecture
- **Bundle Creation** - Signing transactions offline
- **Deferred Attestation** - Fetching proofs when online
- **Queue Management** - Persistent retry logic
- **Network State Detection** - Online/offline transitions
- **Graceful Degradation** - UX with limited connectivity

---

## Project-Specific Knowledge

### BEAM Architecture
- **3-Tier System**: Mobile App → Verifier Service → Solana Program
- **Offline Payment Flow**:
  1. Customer creates unsigned bundle (offline)
  2. Signs with hardware key
  3. Transmits via BLE to merchant
  4. Both fetch attestations (when online)
  5. Either party settles on-chain
- **Security Model**:
  - Hardware attestation prevents fraud
  - Nonce replay protection
  - Bundle hash duplicate detection
  - Verifier signature validation

### File Structure Navigation
```
/Users/vijaygopalb/Beam/
├── mobile/beam-app/         # React Native Android app
│   ├── src/
│   │   ├── screens/         # UI screens (Customer, Merchant, Setup)
│   │   ├── services/        # Business logic (Settlement, BLE, Attestation)
│   │   ├── solana/          # Blockchain client (BeamProgram.ts)
│   │   ├── wallet/          # Wallet management
│   │   ├── storage/         # Data persistence
│   │   ├── components/      # Reusable UI components
│   │   └── config/          # Network configuration
│   └── android/             # Native Android code (Kotlin)
│       └── app/src/main/java/com/beam/app/modules/
│           ├── SecureStorageBridgeModule.kt  # Keystore integration
│           └── BLEPeripheralModule.kt        # BLE GATT server
├── verifier/                # Backend attestation service
│   ├── src/
│   │   ├── attestation/     # Play Integrity verification
│   │   ├── relay/           # Bundle relay storage
│   │   ├── usdc/            # Token minting service
│   │   └── index.ts         # Express server
│   └── api/index.js         # Vercel serverless entry
├── program/                 # Solana on-chain program
│   ├── programs/program/src/
│   │   ├── lib.rs           # Main instruction handlers
│   │   ├── state.rs         # Account structures
│   │   └── attestation.rs   # Signature verification
│   └── tests/               # Anchor integration tests
└── scripts/                 # Utility scripts (USDC mint, testing)
```

### Configuration Files
- **mobile/beam-app/src/config/index.ts** - Network, RPC, program IDs
- **verifier/.env** - Backend secrets (signing key, Google credentials)
- **program/Anchor.toml** - Program deployment config
- **mobile/beam-app/android/gradle.properties** - Build configuration

### Key Constants
- **Program ID**: `6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi` (Devnet)
- **USDC Mint (Devnet)**: `CE32mZMypqjr93o5naYZBnrzHaWcPi1ATuyJwbyApb9N`
- **BLE Service UUID**: `00006265-0000-1000-8000-00805f9b34fb`
- **Verifier URL (Production)**: `https://beam-verifier.vercel.app`
- **Max Attestation Age**: 24 hours (86400 seconds)
- **Max Bundle History**: 32 entries
- **Max Recent Hashes**: 16 entries
- **USDC Decimals**: 6

---

## Learning Resources

### Solana Development
- **Solana Cookbook** - https://solanacookbook.com/
- **Anchor Book** - https://www.anchor-lang.com/docs
- **Solana Documentation** - https://docs.solana.com/
- **Solana Program Library** - https://spl.solana.com/

### React Native
- **React Native Docs** - https://reactnative.dev/docs/getting-started
- **React Navigation** - https://reactnavigation.org/docs/getting-started
- **React Native Testing** - https://callstack.github.io/react-native-testing-library/

### Kotlin & Android
- **Kotlin Docs** - https://kotlinlang.org/docs/home.html
- **Android Developer Guide** - https://developer.android.com/guide
- **Android Keystore** - https://developer.android.com/training/articles/keystore

### Cryptography
- **Practical Cryptography** - https://cryptopals.com/
- **Applied Cryptography** - Bruce Schneier (book)
- **Noble Cryptography** - https://github.com/paulmillr/noble-curves

### BLE Development
- **Bluetooth Core Spec** - https://www.bluetooth.com/specifications/specs/
- **BLE Primer** - https://learn.adafruit.com/introduction-to-bluetooth-low-energy

---

## Common Commands Cheat Sheet

### Mobile App
```bash
# Start Metro bundler
cd mobile/beam-app && pnpm start

# Run on Android device
pnpm android

# Type check (non-blocking)
pnpm exec tsc --noEmit

# Build APK
cd android && ./gradlew assembleDebug

# Install on device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# View logs
adb logcat -s "ReactNativeJS:I"

# Clear app data
adb shell pm clear com.beam.app
```

### Verifier Service
```bash
# Local development
cd verifier && pnpm dev

# Build TypeScript
pnpm build

# Deploy to Vercel
vercel --prod

# Set environment variable
vercel env add VERIFIER_SIGNING_KEY production

# View logs
vercel logs
```

### Solana Program
```bash
# Build program
cd program && anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Run tests
anchor test

# Show program info
solana program show 6BjVpGR1pGJ41xDJF4mMuvC7vymFBZ8QXxoRKFqsuDDi

# Set Solana network
solana config set --url devnet
```

### Utility Scripts
```bash
# Check escrow balance
ts-node scripts/check-escrow-real.ts

# Mint test USDC
ts-node scripts/mint-usdc.ts <address> <amount>

# Create USDC mint
ts-node scripts/create-usdc-mint.ts

# Fund wallet with SOL
ts-node scripts/fund-wallet.ts <address>
```

---

## Troubleshooting Skills

### Common Issues & Solutions

#### Mobile App Won't Build
- Check Android SDK installation
- Verify Java 11 is installed
- Clean build: `cd android && ./gradlew clean`
- Clear Metro cache: `pnpm start --reset-cache`

#### RPC Connection Failures
- Try fallback endpoints (Ankr, AllThatNode)
- Check network connectivity
- Verify Solana network status (status.solana.com)
- Increase timeout in ConnectionService

#### BLE Not Working
- Check Android permissions (Location, Bluetooth)
- Verify BLE is enabled on device
- Check UUID matches (service, characteristics)
- Review adb logcat for native errors

#### Attestation Verification Failing
- Verify hash function matches (SHA256 vs SHA512)
- Check verifier public key in program
- Validate Play Integrity token format
- Ensure attestation timestamp is fresh (<24h)

#### Escrow Balance Shows 0
- Check if escrow account exists (scripts/check-escrow-real.ts)
- Verify RPC endpoint is responding
- Initialize escrow if needed (beamClient.initializeEscrow())
- Check config for hardcoded local IPs

---

## Security Best Practices

### DO
✅ Use hardware-backed keys (Android Keystore)
✅ Validate all inputs (bundle IDs, amounts, pubkeys)
✅ Implement rate limiting on APIs
✅ Use checked arithmetic in Rust (checked_add, checked_sub)
✅ Verify signatures before on-chain operations
✅ Log security events (fraud reports, failed verifications)
✅ Use environment variables for secrets
✅ Implement proper error handling

### DON'T
❌ Hardcode signing keys in source code
❌ Skip signature verification for testing
❌ Allow unlimited API calls without auth
❌ Store private keys in plain text
❌ Trust client-side validation alone
❌ Use production keys in development
❌ Commit .env files to git
❌ Ignore TypeScript type errors

---

## Performance Optimization

### Mobile App
- Lazy load heavy modules
- Use React.memo for expensive components
- Implement virtual lists for large datasets
- Cache network responses
- Optimize image sizes
- Use InteractionManager for heavy tasks
- Profile with React DevTools

### Blockchain
- Batch transactions when possible
- Use compressed accounts (when available)
- Minimize account sizes
- Optimize instruction data packing
- Use lookup tables for frequent accounts
- Parallelize independent operations

### Backend
- Implement response caching
- Use connection pooling
- Enable gzip compression
- Optimize database queries
- Use Redis for hot data
- Implement CDN for static assets
- Monitor cold start times (Vercel)

---

## Contribution Guidelines

### Before Committing
1. Run type check: `pnpm exec tsc --noEmit`
2. Run linter: `pnpm lint`
3. Test locally on physical device
4. Update tests if adding features
5. Document new environment variables
6. Update CLAUDE.md if architecture changes

### Code Style
- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over .then()
- Add JSDoc comments for public APIs
- Use meaningful variable names
- Keep functions under 50 lines
- Extract magic numbers to constants

### Commit Messages
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`
- Be descriptive: "Fix escrow balance RPC timeout" not "fix bug"
- Reference issues: "Fixes #123"

---

## Testing Strategy

### Unit Tests
- Test utility functions (serialization, validation)
- Test cryptographic operations (signing, hashing)
- Test storage operations (CRUD)
- Mock external dependencies

### Integration Tests
- Test settlement flow end-to-end
- Test BLE transmission (on devices)
- Test attestation verification
- Test fraud reporting

### E2E Tests
- Customer creates payment
- Merchant receives via BLE
- Both fetch attestations
- Settlement on-chain succeeds
- Balances update correctly

---

## Deployment Checklist

### Mobile App
- [ ] Update version in package.json
- [ ] Build release APK
- [ ] Test on multiple Android versions
- [ ] Verify BLE works on real devices
- [ ] Test offline functionality
- [ ] Check Play Store compliance

### Verifier Service
- [ ] Set production environment variables
- [ ] Remove dev mode flags
- [ ] Enable rate limiting
- [ ] Add authentication
- [ ] Set up monitoring
- [ ] Configure database (PostgreSQL/Redis)
- [ ] Test with production RPC endpoints

### Solana Program
- [ ] Audit code for security issues
- [ ] Run full test suite
- [ ] Deploy to mainnet-beta
- [ ] Verify program ID in mobile config
- [ ] Test with real USDC
- [ ] Set up monitoring (transaction explorer)

---

## Support & Resources

### Internal Documentation
- `/Users/vijaygopalb/Beam/CLAUDE.md` - Project overview
- `/Users/vijaygopalb/Beam/docs/DEPLOYMENT.md` - Deployment guide
- `/Users/vijaygopalb/Beam/verifier/.env.template` - Environment variables

### External Links
- **GitHub Issues**: [Report bugs and feature requests]
- **Colosseum Discord**: [Hackathon support]
- **Solana Stack Exchange**: https://solana.stackexchange.com/
- **React Native Community**: https://www.reactnative.dev/community/overview

---

## Next Steps for New Contributors

1. **Set up development environment**
   - Install Android Studio, Solana CLI, Anchor CLI
   - Clone repository and install dependencies
   - Configure .env files

2. **Run the app locally**
   - Start verifier service: `cd verifier && pnpm dev`
   - Start mobile app: `cd mobile/beam-app && pnpm start`
   - Run on Android: `pnpm android`

3. **Make a test payment**
   - Create wallet on Setup screen
   - Request test USDC from faucet
   - Scan merchant QR and create payment
   - Observe BLE transmission in logs

4. **Read the code**
   - Start with mobile/beam-app/src/screens/CustomerScreen.tsx
   - Follow payment flow through services
   - Understand BeamProgram.ts client
   - Review Rust program in program/programs/program/src/lib.rs

5. **Fix a bug or add a feature**
   - Check GitHub issues for "good first issue"
   - Follow contribution guidelines
   - Submit pull request

---

**Last Updated**: 2025-01-27
**Maintainer**: BEAM Core Team
**License**: See LICENSE file
