# Beam Setup Guide

Complete setup instructions for developing and running the Beam offline payments system.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Workspace Installation](#workspace-installation)
- [Building Components](#building-components)
- [Running Tests](#running-tests)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

#### 1. Node.js and pnpm

```bash
# Node.js 18+ required
node --version  # Should be >= 18.0.0

# Install pnpm globally
npm install -g pnpm@latest

# Verify pnpm installation
pnpm --version  # Should be >= 8.0.0
```

#### 2. Rust and Cargo

```bash
# Install Rust using rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installation
rustc --version
cargo --version
```

#### 3. Solana CLI

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Add to PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify installation
solana --version  # Should be >= 1.18.0

# Configure for devnet
solana config set --url devnet

# Create a keypair (if you don't have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Get your public key
solana address

# Airdrop devnet SOL for testing
solana airdrop 2
```

#### 4. Anchor CLI

```bash
# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Verify installation
anchor --version  # Should be >= 0.31.0
```

#### 5. Android Development Environment

For mobile app development:

**macOS:**

```bash
# Install Android Studio from https://developer.android.com/studio
# Or via Homebrew
brew install --cask android-studio

# Set environment variables (add to ~/.bashrc or ~/.zshrc)
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin

# Install JDK 17
brew install openjdk@17
```

**Linux:**

```bash
# Install JDK 17
sudo apt-get install openjdk-17-jdk

# Download Android command-line tools
# Set ANDROID_HOME environment variable
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

**Android SDK Components:**

```bash
# Install required SDK packages
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
sdkmanager "system-images;android-34;google_apis;x86_64"

# Create an emulator (optional)
avdmanager create avd -n Pixel_5_API_34 -k "system-images;android-34;google_apis;x86_64"
```

#### 6. Watchman (for React Native)

```bash
# macOS
brew install watchman

# Linux
# Follow instructions at https://facebook.github.io/watchman/docs/install
```

### Optional Tools

- **Visual Studio Code** - Recommended IDE with extensions:
  - Rust Analyzer
  - Solana Tools
  - React Native Tools
  - ESLint
  - Prettier

- **Docker** - For containerized verifier deployment

## Quick Start

Get up and running in 5 minutes:

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/beam.git
cd Beam

# 2. Install all dependencies
pnpm install

# 3. Build the Solana program
cd program
anchor build
anchor deploy --provider.cluster devnet
cd ..

# 4. Build shared library
cd mobile/shared
pnpm build
cd ../..

# 5. Start the verifier service
cd verifier
cp .env.example .env
# Edit .env with your configuration
pnpm dev
# In another terminal, continue...

# 6. Run the mobile app
cd mobile/beam-app
pnpm install
pnpm android  # or pnpm ios for iOS
```

## Workspace Installation

Beam uses a pnpm workspace monorepo structure.

### Initial Setup

```bash
# From the root directory
pnpm install
```

This installs dependencies for all workspace packages:
- `program` - Anchor Solana program
- `mobile/shared` - Shared TypeScript library
- `mobile/beam-app` - React Native mobile app
- `verifier` - Attestation verifier service

### Verify Installation

```bash
# Check all packages are linked
pnpm list --depth 0

# Verify workspace configuration
cat pnpm-workspace.yaml
```

## Building Components

### 1. Shared Library

The shared library contains common types, cryptography, and bundle logic.

```bash
cd mobile/shared

# Install dependencies (if not done already)
pnpm install

# Build TypeScript to JavaScript
pnpm build

# Development mode (watch for changes)
pnpm dev

# Run tests
pnpm test
```

**Output:** Compiled JavaScript in `dist/` directory.

### 2. Solana Program

The Anchor program handles escrow, settlement, and on-chain verification.

```bash
cd program

# Build the program
anchor build

# This generates:
# - target/deploy/beam.so (program binary)
# - target/idl/beam.json (Interface Definition Language)
# - target/types/beam.ts (TypeScript types)

# Deploy to localnet (requires validator running)
anchor deploy

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet-beta (use with caution)
anchor deploy --provider.cluster mainnet-beta

# Update program ID in Anchor.toml and lib.rs after first deployment
anchor keys list
```

**Important:** After deploying, update the program ID in:
- `program/Anchor.toml`
- `program/programs/program/src/lib.rs` (declare_id! macro)
- `mobile/beam-app/src/config/index.ts`

### 3. Mobile App

React Native app for Android and iOS.

```bash
cd mobile/beam-app

# Install dependencies
pnpm install

# Install iOS pods (macOS only)
cd ios && pod install && cd ..

# Build for Android
pnpm android

# Build for iOS (macOS only)
pnpm ios

# Build release APK
cd android
./gradlew assembleRelease
cd ..
# APK at: android/app/build/outputs/apk/release/app-release.apk

# Clean builds
pnpm clean:android  # Clean Android build
pnpm clean:ios      # Clean iOS build
pnpm clean          # Clean both
```

### 4. Verifier Service

Node.js service for attestation verification.

```bash
cd verifier

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Development mode
pnpm dev

# Production mode
pnpm start
```

**Configuration:**

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your settings
nano .env
```

Required environment variables:

```bash
PORT=3000
DEV_MODE=true
VERIFIER_SIGNING_KEY=your_ed25519_key_hex
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
```

## Running Tests

### Shared Library Tests

```bash
cd mobile/shared
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage
```

### Solana Program Tests

```bash
cd program

# Run all tests (starts local validator automatically)
anchor test

# Run specific test file
anchor test --skip-local-validator tests/simple-test.ts

# Keep validator running
anchor test --skip-deploy
```

### Mobile App Tests

```bash
cd mobile/beam-app

# Run Jest tests
pnpm test

# Watch mode
pnpm test --watch
```

### Verifier Tests

```bash
cd verifier

# Run tests
pnpm test

# Watch mode
pnpm test --watch
```

### Integration Tests

```bash
# From root directory
pnpm test:all
```

## Development Workflow

### Day-to-Day Development

#### 1. Start Local Validator

```bash
# Terminal 1: Local Solana validator
cd program
anchor localnet

# Or use solana-test-validator
solana-test-validator --reset
```

#### 2. Deploy Program

```bash
# Terminal 2: Build and deploy
cd program
anchor build
anchor deploy
```

#### 3. Start Verifier

```bash
# Terminal 3: Verifier service
cd verifier
pnpm dev
```

#### 4. Run Mobile App

```bash
# Terminal 4: Mobile app
cd mobile/beam-app
pnpm start

# Terminal 5: Android
pnpm android

# Or iOS (macOS only)
pnpm ios
```

### Making Changes

#### Modify Solana Program

```bash
cd program/programs/program/src

# Edit lib.rs
nano lib.rs

# Rebuild and redeploy
anchor build
anchor deploy

# Update IDL in mobile app
cp target/idl/beam.json ../mobile/beam-app/src/idl/
```

#### Modify Shared Library

```bash
cd mobile/shared/src

# Edit source files
nano bundle.ts

# Rebuild (or use watch mode)
pnpm build

# Changes automatically available to beam-app via workspace
```

#### Modify Mobile App

```bash
cd mobile/beam-app/src

# Edit source files
# React Native will auto-reload

# Force reload: Press 'r' in Metro terminal
# Open dev menu: Cmd+M (Android) or Cmd+D (iOS)
```

### Hot Reload

- **Mobile App:** React Native Fast Refresh enabled by default
- **Verifier:** Uses `tsx watch` for auto-restart
- **Shared:** Use `pnpm dev` for watch mode
- **Program:** Requires manual rebuild and deployment

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes and commit
git add .
git commit -m "feat: your feature description"

# Push to remote
git push origin feature/your-feature

# Create pull request on GitHub
```

## Troubleshooting

### Common Issues

#### 1. `pnpm install` fails

**Solution:**

```bash
# Clear pnpm cache
pnpm store prune

# Remove node_modules and lockfile
rm -rf node_modules pnpm-lock.yaml

# Reinstall
pnpm install
```

#### 2. Anchor build fails

**Error:** "package `solana-program` not found"

**Solution:**

```bash
# Update Rust
rustup update

# Clean build artifacts
cd program
anchor clean
cargo clean

# Rebuild
anchor build
```

#### 3. Android build fails

**Error:** "SDK location not found"

**Solution:**

```bash
# Create local.properties
cd mobile/beam-app/android
echo "sdk.dir=$ANDROID_HOME" > local.properties

# Or set ANDROID_HOME environment variable
export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS
```

#### 4. Program deployment fails

**Error:** "Insufficient funds"

**Solution:**

```bash
# Check balance
solana balance

# Airdrop more SOL (devnet only)
solana airdrop 2

# For mainnet, transfer SOL to your wallet
```

#### 5. Metro bundler port conflict

**Error:** "Port 8081 already in use"

**Solution:**

```bash
# Kill process on port 8081
lsof -ti:8081 | xargs kill -9

# Or specify different port
pnpm start --port 8082
```

#### 6. Verifier won't start

**Error:** "VERIFIER_SIGNING_KEY not configured"

**Solution:**

```bash
# Generate Ed25519 key
openssl genpkey -algorithm ed25519 -outform DER | xxd -p -c 64

# Add to .env
echo "VERIFIER_SIGNING_KEY=your_key_here" >> .env
```

#### 7. TypeScript errors in workspace

**Solution:**

```bash
# Rebuild shared library
cd mobile/shared
pnpm build

# Restart TypeScript server in your IDE
# VS Code: Cmd+Shift+P -> "TypeScript: Restart TS Server"
```

### Platform-Specific Issues

#### macOS

**Issue:** Xcode Command Line Tools not found

```bash
xcode-select --install
```

**Issue:** CocoaPods dependency errors

```bash
cd mobile/beam-app/ios
rm -rf Pods Podfile.lock
pod install --repo-update
```

#### Linux

**Issue:** Permission denied on Android SDK

```bash
chmod -R 755 $ANDROID_HOME
```

#### Windows (WSL2 recommended)

**Issue:** File system performance

Use WSL2 with files on Linux filesystem, not /mnt/c/

### Getting Help

1. **Check logs:**
   - Metro bundler output
   - Android logcat: `adb logcat`
   - Verifier console output
   - Anchor test output

2. **Clear all caches:**
   ```bash
   # React Native
   cd mobile/beam-app
   rm -rf node_modules
   pnpm start --reset-cache

   # Android
   cd android
   ./gradlew clean
   rm -rf ~/.gradle/caches
   ```

3. **Documentation:**
   - [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
   - [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment guide
   - [Anchor Docs](https://www.anchor-lang.com/)
   - [React Native Docs](https://reactnative.dev/)

4. **Community:**
   - GitHub Issues
   - Solana Stack Exchange
   - Anchor Discord

## Next Steps

After setup is complete:

1. **Read the architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Deploy to production:** [DEPLOYMENT.md](./DEPLOYMENT.md)
3. **Run the demo:** Follow demo walkthrough in README.md
4. **Explore the code:** Start with `mobile/beam-app/src/App.tsx`

## Environment Configuration

### Development

```bash
# program/Anchor.toml
cluster = "Localnet"

# mobile/beam-app/.env
SOLANA_CLUSTER=devnet
VERIFIER_URL=http://localhost:3000

# verifier/.env
DEV_MODE=true
```

### Production

```bash
# program/Anchor.toml
cluster = "Mainnet"

# mobile/beam-app/.env
SOLANA_CLUSTER=mainnet-beta
VERIFIER_URL=https://verifier.beam.app

# verifier/.env
DEV_MODE=false
```

## Useful Commands Reference

```bash
# Workspace
pnpm install              # Install all dependencies
pnpm build:program        # Build Solana program
pnpm test:all            # Run all tests
pnpm dev:verifier        # Start verifier in dev mode

# Solana
solana balance           # Check wallet balance
solana address           # Show public key
solana airdrop 2         # Get devnet SOL
anchor build             # Build program
anchor deploy            # Deploy program
anchor test              # Run tests

# Mobile
pnpm android             # Run Android app
pnpm ios                 # Run iOS app
pnpm start               # Start Metro bundler
pnpm lint                # Lint code

# Debugging
adb logcat               # Android logs
react-native log-android # React Native Android logs
react-native log-ios     # React Native iOS logs
```

---

For deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).
