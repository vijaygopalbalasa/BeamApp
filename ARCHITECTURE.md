# Beam Architecture

Comprehensive technical architecture documentation for the Beam offline payment system.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Principles](#architecture-principles)
- [Component Architecture](#component-architecture)
- [Offline Payment Flow](#offline-payment-flow)
- [Escrow and PDAs](#escrow-and-pdas)
- [Attestation Flow](#attestation-flow)
- [Settlement Process](#settlement-process)
- [Security Model](#security-model)
- [Data Flow](#data-flow)
- [Cryptographic Design](#cryptographic-design)
- [State Management](#state-management)
- [Error Handling](#error-handling)

## System Overview

Beam is a decentralized offline-first payment system built on Solana that enables peer-to-peer payments without internet connectivity using escrow-backed trust and cryptographic signatures.

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Beam System Architecture                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    OFFLINE ENVIRONMENT                          │  │
│  │                    (No Internet Required)                       │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  ┌───────────────┐                      ┌───────────────┐      │  │
│  │  │   Customer    │                      │   Merchant    │      │  │
│  │  │   Mobile App  │ ◄──────────────────►│   Mobile App  │      │  │
│  │  └───────────────┘                      └───────────────┘      │  │
│  │         │                                        │              │  │
│  │         │ 1. Create Bundle                       │              │  │
│  │         │ 2. Sign with Ed25519                   │              │  │
│  │         │ 3. Transfer (QR/BLE)                   │              │  │
│  │         │                4. Verify ◄─────────────┤              │  │
│  │         │                5. Co-sign              │              │  │
│  │         │                                        │              │  │
│  │  [Local Storage]                       [Local Storage]          │  │
│  │   - Bundle Queue                        - Bundle Queue          │  │
│  │   - Wallet Keys                         - Wallet Keys           │  │
│  │   - Attestations                        - Attestations          │  │
│  │                                                                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                 │                                     │
│                                 │ Internet Connection Restored        │
│                                 ▼                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     ONLINE ENVIRONMENT                          │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │                                                                  │  │
│  │  ┌──────────────────┐         ┌──────────────────┐            │  │
│  │  │  Verifier Service│         │  Solana Mainnet  │            │  │
│  │  │  (Node.js)       │         │  (Anchor Program)│            │  │
│  │  ├──────────────────┤         ├──────────────────┤            │  │
│  │  │ - Verify Attest. │         │ - Escrow PDA     │            │  │
│  │  │ - Check Nonce    │         │ - Nonce Registry │            │  │
│  │  │ - Generate Proof │         │ - Token Transfer │            │  │
│  │  └──────────────────┘         └──────────────────┘            │  │
│  │         ▲                              ▲                        │  │
│  │         │                              │                        │  │
│  │         └──────────────┬───────────────┘                        │  │
│  │                        │                                         │  │
│  │                 Mobile App (Online)                             │  │
│  │              Submits Settlement Request                         │  │
│  │                                                                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Architecture Principles

### 1. Offline-First Design

- **Principle:** All payment operations must work without internet
- **Implementation:**
  - Payment bundles created and signed locally
  - Cryptographic verification without network calls
  - Local persistence of pending transactions
  - Settlement deferred until connectivity restored

### 2. Escrow-Backed Trust

- **Principle:** Pre-funded escrow eliminates merchant risk
- **Implementation:**
  - Customer deposits funds in Solana escrow PDA
  - Merchant verifies escrow balance before accepting payment
  - On-chain settlement guaranteed if bundle is valid
  - No chargeback mechanism (blockchain immutability)

### 3. Dual-Signature Verification

- **Principle:** Both parties must sign for mutual proof
- **Implementation:**
  - Customer signs payment bundle (commitment)
  - Merchant co-signs bundle (acknowledgment)
  - Both parties retain cryptographic proof
  - Disputes resolved via signature verification

### 4. Replay Protection

- **Principle:** Prevent reuse of old payment bundles
- **Implementation:**
  - Monotonically increasing nonces per customer
  - On-chain nonce registry validates order
  - Bundle ID collision detection
  - Time-based staleness checks

### 5. Defense in Depth

- **Principle:** Multiple security layers for comprehensive protection
- **Implementation:**
  - Cryptographic signatures (Ed25519)
  - Device attestation (Play Integrity API)
  - Verifier-signed proofs
  - On-chain validation
  - Fraud detection system

## Component Architecture

### 1. Mobile App (React Native)

```
mobile/beam-app/
├── src/
│   ├── screens/           # UI screens
│   │   ├── SetupScreen.tsx       # Wallet & escrow setup
│   │   ├── CustomerScreen.tsx    # Create payments
│   │   ├── MerchantScreen.tsx    # Receive payments
│   │   └── WalletScreen.tsx      # Manage wallet
│   │
│   ├── services/          # Business logic
│   │   ├── AttestationService.ts  # Device attestation
│   │   ├── SettlementService.ts   # Submit to blockchain
│   │   └── BLEService.ts          # Bluetooth exchange
│   │
│   ├── storage/           # Persistence
│   │   └── BundleStorage.ts       # AsyncStorage wrapper
│   │
│   ├── native/            # Native bridges
│   │   └── SecureStorageBridge.ts # Android KeyStore
│   │
│   ├── solana/            # Blockchain integration
│   │   ├── BeamProgram.ts         # Anchor client
│   │   └── types.ts               # On-chain types
│   │
│   └── config/            # Configuration
│       └── index.ts               # Environment config
│
└── android/               # Native Android code
    └── app/src/main/java/com/beam/app/
        └── bridge/
            └── SecureStorageBridgeModule.kt  # Keystore & attestation
```

**Key Responsibilities:**
- Wallet key generation and management
- Offline payment bundle creation
- QR code generation and scanning
- Bluetooth Low Energy (BLE) communication
- Local bundle queue management
- Automatic settlement when online
- Device attestation generation

**Technology Stack:**
- React Native 0.76.6
- TypeScript 5.3.3
- @coral-xyz/anchor for Solana
- @noble/ed25519 for cryptography
- React Native Keychain for secure storage
- AsyncStorage for persistence

### 2. Shared Library (@beam/shared)

```
mobile/shared/
├── src/
│   ├── bundle.ts          # Bundle creation and signing
│   ├── crypto.ts          # Ed25519 utilities
│   ├── types.ts           # TypeScript types
│   ├── qr.ts              # QR code generation
│   ├── serialization.ts   # Canonical serialization
│   └── attestation/
│       ├── types.ts       # Attestation types
│       └── verify.ts      # Client-side verification
└── dist/                  # Compiled output
```

**Key Responsibilities:**
- Bundle data structure definitions
- Cryptographic primitives (signing, verification)
- Canonical serialization for deterministic hashing
- Type definitions shared across components
- QR code encoding/decoding

### 3. Solana Program (Anchor)

```
program/
├── programs/program/src/
│   ├── lib.rs             # Main program logic
│   ├── state.rs           # Account structures
│   └── attestation.rs     # Attestation verification
├── target/
│   ├── deploy/beam.so     # Compiled program
│   ├── idl/beam.json      # Interface definition
│   └── types/beam.ts      # TypeScript types
└── tests/
    └── simple-test.ts     # Integration tests
```

**Key Responsibilities:**
- Escrow account management (initialization, funding)
- Settlement transaction processing
- Attestation proof verification
- Nonce-based replay protection
- SPL token transfers
- Fraud detection and reporting

**Account Structure:**

```rust
// Escrow Account (PDA)
pub struct EscrowAccount {
    pub owner: Pubkey,                    // Customer wallet
    pub escrow_token_account: Pubkey,     // Token account holding USDC
    pub escrow_balance: u64,              // Current balance
    pub last_nonce: u64,                  // Last used nonce
    pub reputation_score: u16,            // Reputation (0-100)
    pub total_spent: u64,                 // Lifetime spending
    pub created_at: i64,                  // Timestamp
    pub bump: u8,                         // PDA bump seed
}

// Nonce Registry (PDA)
pub struct NonceRegistry {
    pub owner: Pubkey,                    // Customer wallet
    pub used_nonces: Vec<u64>,            // Recently used nonces
    pub bundle_history: Vec<BundleRecord>, // Settlement history
    pub fraud_reports: Vec<FraudRecord>,  // Detected fraud
    pub bump: u8,                         // PDA bump seed
}
```

### 4. Verifier Service (Node.js)

```
verifier/
├── src/
│   ├── index.ts           # Express server
│   ├── attestation/
│   │   ├── index.ts       # Main verification logic
│   │   ├── google.ts      # Play Integrity verification
│   │   └── types.ts       # Verification types
│   └── utils/
│       └── crypto.ts      # Ed25519 signing
└── dist/                  # Compiled output
```

**Key Responsibilities:**
- Play Integrity JWT verification
- Device attestation validation
- Bundle summary verification
- Verifier proof generation (signed root)
- Rate limiting and abuse prevention
- Logging and monitoring

**API Endpoints:**

```typescript
POST /verify
{
  bundleId: string;
  bundleSummary: BundleSummary;
  payerAttestation: AttestationEnvelope;
  merchantAttestation: AttestationEnvelope;
}

Response:
{
  valid: boolean;
  proofs?: {
    payer: VerifierProof;
    merchant: VerifierProof;
  };
  reason?: string;
}
```

## Offline Payment Flow

### Step-by-Step Process

#### Phase 1: Initialization (Online, One-time)

```
Customer                        Solana Blockchain
   │                                   │
   │  1. Create Wallet                 │
   │     (Generate Ed25519 keypair)    │
   │                                   │
   │  2. Initialize Escrow ───────────►│
   │     (Deposit USDC)                │
   │                                   │
   │◄───────────────────────────────── │
   │  3. Escrow PDA Created            │
   │     (Funds locked on-chain)       │
```

**Escrow Initialization:**

```typescript
// Mobile app
const escrowAmount = 100_000000; // 100 USDC (6 decimals)

await beamProgram.methods
  .initializeEscrow(new BN(escrowAmount))
  .accounts({
    owner: walletPublicKey,
    escrowAccount: escrowPDA,
    escrowTokenAccount: escrowTokenPDA,
    ownerTokenAccount: userTokenAccount,
    mint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

#### Phase 2: Offline Payment Creation

```
Customer                        Merchant
   │                               │
   │  1. Create Bundle             │
   │     - amount: 10 USDC         │
   │     - merchant: pubkey        │
   │     - nonce: 1                │
   │                               │
   │  2. Sign Bundle               │
   │     (Ed25519 signature)       │
   │                               │
   │  3. Generate Attestation      │
   │     (Play Integrity API)      │
   │                               │
   │  4. Transfer Bundle ─────────►│
   │     (QR code or BLE)          │
   │                               │
   │                               │  5. Verify Signature
   │                               │     (Customer pubkey)
   │                               │
   │                               │  6. Generate Own Attestation
   │                               │     (Play Integrity API)
   │                               │
   │                               │  7. Co-sign Bundle
   │◄─────────────────────────────│     (Merchant signature)
   │  8. Both Have Proof           │
```

**Bundle Structure:**

```typescript
interface OfflineBundle {
  bundleId: string;           // Unique identifier (UUID)
  payer: string;              // Customer public key
  merchant: string;           // Merchant public key
  amount: number;             // Payment amount (lamports)
  nonce: number;              // Monotonic nonce
  timestamp: number;          // Creation timestamp
  payerSignature: Uint8Array; // Customer Ed25519 signature
  merchantSignature?: Uint8Array; // Merchant Ed25519 signature (added later)
}
```

**Canonical Serialization:**

```typescript
function serializeBundle(bundle: OfflineBundle): Uint8Array {
  // Deterministic encoding for consistent hashing
  const fields = [
    encodeString(bundle.bundleId),
    encodePublicKey(bundle.payer),
    encodePublicKey(bundle.merchant),
    encodeU64(bundle.amount),
    encodeU64(bundle.nonce),
    encodeI64(bundle.timestamp),
  ];

  return concat(fields);
}

// Hash for signing
const bundleHash = sha256(serializeBundle(bundle));

// Sign
const signature = ed25519.sign(bundleHash, privateKey);
```

#### Phase 3: Attestation Generation

```
Mobile App                  Google Play Services           Verifier
   │                               │                          │
   │  1. Generate Nonce            │                          │
   │     (random + bundle hash)    │                          │
   │                               │                          │
   │  2. Request Integrity Token   │                          │
   │────────────────────────────► │                          │
   │                               │                          │
   │                               │  3. Device Checks        │
   │                               │     - SafetyNet          │
   │                               │     - Play Protect       │
   │                               │     - App Authenticity   │
   │                               │                          │
   │  4. JWT Token ◄──────────────│                          │
   │     (signed by Google)        │                          │
   │                               │                          │
   │  5. Sign with Wallet Key      │                          │
   │     (Ed25519)                 │                          │
   │                               │                          │
   │  6. Store Attestation         │                          │
   │     Envelope                  │                          │
```

**Attestation Envelope:**

```typescript
interface AttestationEnvelope {
  bundleId: string;
  timestamp: number;
  nonce: Uint8Array;              // 32 random bytes
  signature: Uint8Array;          // Ed25519 signature from wallet
  attestationReport: Uint8Array;  // JWT from Play Integrity
  certificateChain: Uint8Array[]; // Empty for Play Integrity
  deviceInfo: DeviceInfo;
  attestationType: 'PLAY_INTEGRITY' | 'KEY_ATTESTATION';
}
```

## Escrow and PDAs

### Program Derived Addresses (PDAs)

PDAs are deterministic addresses derived from seeds, controlled by the program.

#### Escrow Account PDA

```rust
// Seeds: ["escrow", owner_pubkey]
let (escrow_pda, bump) = Pubkey::find_program_address(
    &[b"escrow", owner.key().as_ref()],
    program_id
);
```

**Properties:**
- One escrow per customer wallet
- Deterministically derived (no private key)
- Controlled by Beam program
- Holds customer's USDC in escrow

#### Escrow Token Account PDA

```rust
// Seeds: ["escrow_token", owner_pubkey, mint]
let (escrow_token_pda, _) = Pubkey::find_program_address(
    &[b"escrow_token", owner.key().as_ref(), mint.key().as_ref()],
    program_id
);
```

**Properties:**
- Associated token account for escrow
- Holds actual USDC tokens
- Program has authority to transfer

#### Nonce Registry PDA

```rust
// Seeds: ["nonce_registry", owner_pubkey]
let (nonce_registry_pda, bump) = Pubkey::find_program_address(
    &[b"nonce_registry", owner.key().as_ref()],
    program_id
);
```

**Properties:**
- Tracks used nonces per customer
- Stores bundle settlement history
- Records fraud attempts
- Enables replay protection

### Escrow State Transitions

```
┌─────────────────┐
│  Uninitialized  │
└────────┬────────┘
         │ initialize_escrow(amount)
         ▼
┌─────────────────┐
│   Initialized   │
│  balance: N     │
└────────┬────────┘
         │ fund_escrow(amount)
         ▼
┌─────────────────┐
│     Funded      │
│  balance: N+M   │
└────────┬────────┘
         │ settle_offline_payment(amount)
         ▼
┌─────────────────┐
│    Reduced      │
│  balance: N+M-X │
└─────────────────┘
         │
         │ (can fund again or continue settling)
         │
         ▼
┌─────────────────┐
│    Depleted     │
│  balance: 0     │
└─────────────────┘
```

## Attestation Flow

### Device Attestation Purpose

1. **Prove device authenticity** - Device is genuine Android device
2. **Verify app integrity** - App is unmodified and from Play Store
3. **Bind to bundle** - Attestation tied to specific payment bundle
4. **Generate trusted proof** - Verifier signs attestation root

### Play Integrity API Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    Play Integrity Attestation                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. App generates nonce                                           │
│     nonce = random(32 bytes) || sha256(bundle)                   │
│                                                                    │
│  2. Request integrity token                                       │
│     IntegrityManager.requestIntegrityToken(nonce, cloudProjectNum)│
│                                                                    │
│  3. Google Play Services validates:                               │
│     ✓ Device passed SafetyNet/Play Protect                       │
│     ✓ App signature matches Play Store                           │
│     ✓ App installed via Play Store                               │
│     ✓ APK not tampered                                           │
│                                                                    │
│  4. Returns signed JWT:                                           │
│     {                                                             │
│       "nonce": "base64(nonce)",                                   │
│       "timestampMillis": 1234567890,                              │
│       "deviceIntegrity": {                                        │
│         "deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"]    │
│       },                                                          │
│       "appIntegrity": {                                           │
│         "appRecognitionVerdict": "PLAY_RECOGNIZED",               │
│         "packageName": "com.beam.app",                            │
│         "certificateSha256Digest": ["sha256..."]                  │
│       }                                                           │
│     }                                                             │
│                                                                    │
│  5. App wraps JWT in attestation envelope                         │
│  6. App signs envelope with wallet key                            │
│  7. Store with bundle for later verification                      │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Verifier Attestation Verification

```typescript
// verifier/src/attestation/google.ts

async function verifyPlayIntegrityJWS(jws: string): Promise<IntegrityPayload> {
  // 1. Parse JWT (header.payload.signature)
  const [headerB64, payloadB64, signatureB64] = jws.split('.');

  // 2. Fetch Google's public keys (cached)
  const googleKeys = await fetchGooglePublicKeys();

  // 3. Verify signature
  const verified = await verifyJWTSignature(
    `${headerB64}.${payloadB64}`,
    signatureB64,
    googleKeys
  );

  if (!verified) {
    throw new Error('JWT signature verification failed');
  }

  // 4. Parse and validate payload
  const payload = JSON.parse(base64Decode(payloadB64));

  // 5. Check timestamp (must be recent)
  const now = Date.now();
  const tokenAge = now - payload.timestampMillis;
  if (tokenAge > 5 * 60 * 1000) { // 5 minutes
    throw new Error('Token expired');
  }

  // 6. Validate nonce
  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch');
  }

  // 7. Check device integrity
  const deviceVerdict = payload.deviceIntegrity.deviceRecognitionVerdict;
  if (!deviceVerdict.includes('MEETS_DEVICE_INTEGRITY')) {
    throw new Error('Device failed integrity check');
  }

  // 8. Check app integrity
  if (payload.appIntegrity.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
    throw new Error('App not recognized by Play Store');
  }

  // 9. Validate package name
  if (payload.appIntegrity.packageName !== EXPECTED_PACKAGE_NAME) {
    throw new Error('Package name mismatch');
  }

  // 10. Check APK certificate (if configured)
  const certDigest = payload.appIntegrity.certificateSha256Digest[0];
  if (ALLOWED_DIGESTS.length > 0 && !ALLOWED_DIGESTS.includes(certDigest)) {
    throw new Error('APK certificate not allowed');
  }

  return payload;
}
```

### Verifier Proof Generation

```typescript
// After successful attestation verification

interface VerifierProof {
  attestationRoot: Uint8Array;  // Hash of verified attestation
  verifierSignature: Uint8Array; // Ed25519 signature by verifier
  timestamp: number;
  role: 'payer' | 'merchant';
}

function generateVerifierProof(
  attestation: AttestationEnvelope,
  role: AttestationRole
): VerifierProof {
  // 1. Create attestation root (hash of verified data)
  const root = sha256(
    attestation.nonce,
    attestation.signature,
    attestation.attestationReport,
    role
  );

  // 2. Sign with verifier's private key
  const signature = ed25519.sign(root, VERIFIER_PRIVATE_KEY);

  return {
    attestationRoot: root,
    verifierSignature: signature,
    timestamp: Date.now(),
    role,
  };
}
```

## Settlement Process

### On-Chain Settlement Flow

```
Customer App                Verifier Service           Solana Program
     │                            │                          │
     │  1. Submit Settlement      │                          │
     │────────────────────────────►                          │
     │    (bundle + attestations) │                          │
     │                            │                          │
     │                            │  2. Verify Attestations  │
     │                            │     - Check JWT sig      │
     │                            │     - Validate nonce     │
     │                            │     - Device integrity   │
     │                            │                          │
     │                            │  3. Generate Proofs      │
     │                            │     (signed roots)       │
     │                            │                          │
     │  4. Return Proofs ◄────────│                          │
     │                            │                          │
     │  5. Submit Transaction ───────────────────────────────►
     │    (bundle + proofs)       │                          │
     │                            │                          │
     │                            │                          │  6. Verify Proofs
     │                            │                          │     - Check verifier sig
     │                            │                          │     - Validate root
     │                            │                          │
     │                            │                          │  7. Verify Bundle
     │                            │                          │     - Check signatures
     │                            │                          │     - Validate nonce
     │                            │                          │     - Check escrow
     │                            │                          │
     │                            │                          │  8. Execute Transfer
     │                            │                          │     escrow → merchant
     │                            │                          │
     │                            │                          │  9. Update State
     │                            │                          │     - last_nonce
     │                            │                          │     - balance
     │                            │                          │     - history
     │                            │                          │
     │  10. Transaction Success ◄────────────────────────────│
     │                            │                          │
```

### Settlement Instruction

```rust
pub fn settle_offline_payment(
    ctx: Context<SettlePayment>,
    amount: u64,
    payer_nonce: u64,
    bundle_id: String,
    evidence: SettlementEvidence,
) -> Result<()> {
    // 1. Validate inputs
    require!(!bundle_id.is_empty(), BeamError::InvalidBundleId);
    require!(amount > 0, BeamError::InvalidAmount);

    // 2. Verify attestation proofs
    let payer_proof = evidence.payer_proof.ok_or(BeamError::MissingAttestation)?;
    require!(
        verify_attestation(&payer_proof, AttestationRole::Payer),
        BeamError::InvalidAttestation
    );

    let merchant_proof = evidence.merchant_proof.ok_or(BeamError::MissingAttestation)?;
    require!(
        verify_attestation(&merchant_proof, AttestationRole::Merchant),
        BeamError::InvalidAttestation
    );

    // 3. Validate nonce (replay protection)
    let escrow = &mut ctx.accounts.escrow_account;
    require!(
        payer_nonce > escrow.last_nonce,
        BeamError::InvalidNonce
    );

    // 4. Check bundle not already settled
    let nonce_registry = &mut ctx.accounts.nonce_registry;
    require!(
        !nonce_registry.used_nonces.contains(&payer_nonce),
        BeamError::NonceAlreadyUsed
    );

    // 5. Verify escrow balance
    require!(
        escrow.escrow_balance >= amount,
        BeamError::InsufficientBalance
    );

    // 6. Verify signatures
    require!(
        verify_bundle_signatures(&evidence.bundle_hash, &evidence.signatures),
        BeamError::InvalidSignature
    );

    // 7. Execute token transfer
    let escrow_seeds = &[
        b"escrow",
        escrow.owner.as_ref(),
        &[escrow.bump],
    ];
    let signer = &[&escrow_seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.merchant_token_account.to_account_info(),
                authority: ctx.accounts.escrow_account.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    // 8. Update state
    escrow.last_nonce = payer_nonce;
    escrow.escrow_balance -= amount;
    escrow.total_spent += amount;

    // 9. Record in nonce registry
    nonce_registry.used_nonces.push(payer_nonce);
    nonce_registry.bundle_history.push(BundleRecord {
        bundle_id: bundle_id.clone(),
        amount,
        merchant: ctx.accounts.merchant.key(),
        settled_at: Clock::get()?.unix_timestamp,
        nonce: payer_nonce,
    });

    // 10. Emit event
    emit!(PaymentSettled {
        bundle_id,
        payer: escrow.owner,
        merchant: ctx.accounts.merchant.key(),
        amount,
        nonce: payer_nonce,
    });

    Ok(())
}
```

## Security Model

### Threat Model

#### Threats We Protect Against

1. **Double-Spending**
   - **Attack:** Reuse same bundle with multiple merchants
   - **Protection:** Nonce-based replay protection on-chain

2. **Bundle Forgery**
   - **Attack:** Create fake payment without customer authorization
   - **Protection:** Ed25519 signature verification

3. **Device Tampering**
   - **Attack:** Modified app or rooted device
   - **Protection:** Play Integrity API attestation

4. **Replay Attacks**
   - **Attack:** Replay old valid bundle
   - **Protection:** Monotonic nonces, time-based staleness

5. **Man-in-the-Middle**
   - **Attack:** Intercept and modify bundle during transfer
   - **Protection:** Cryptographic signatures detect tampering

6. **Verifier Compromise**
   - **Attack:** Fake verifier approves invalid attestations
   - **Protection:** On-chain verification of verifier signatures

#### Threats We Don't Protect Against (Out of Scope)

1. **Physical Device Theft**
   - Mitigation: Biometric authentication, PIN protection
   - Not foolproof if device unlocked

2. **Keylogger on Device**
   - Mitigation: Use hardware security module
   - Limited protection against compromised OS

3. **Social Engineering**
   - Customer tricked into sending payment
   - No technical solution

### Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Application Security                               │
│  - Biometric authentication                                 │
│  - PIN/password protection                                  │
│  - App obfuscation (ProGuard)                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Cryptographic Security                            │
│  - Ed25519 signatures (bundle integrity)                   │
│  - SHA-256 hashing (deterministic)                         │
│  - Secure key generation (Android KeyStore)                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Device Attestation                                │
│  - Play Integrity API (device trust)                       │
│  - SafetyNet verdict (rootkit detection)                   │
│  - App authenticity (Play Store verification)              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Verifier Validation                               │
│  - JWT signature verification                              │
│  - Nonce validation (bundle binding)                       │
│  - Timestamp freshness checks                              │
│  - Verifier-signed proofs                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: On-Chain Validation                               │
│  - Signature verification (payer + merchant)               │
│  - Nonce replay protection                                 │
│  - Escrow balance checks                                   │
│  - Fraud detection system                                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Management

#### Customer Wallet Key

- **Generation:** Android KeyStore with StrongBox (if available)
- **Storage:** Encrypted in secure hardware enclave
- **Access:** Protected by biometric or PIN
- **Backup:** User responsible (seed phrase export)

```kotlin
// Android KeyStore key generation
val keyPairGenerator = KeyPairGenerator.getInstance(
    KeyProperties.KEY_ALGORITHM_EC,
    "AndroidKeyStore"
)

val parameterSpec = KeyGenParameterSpec.Builder(
    "beam_wallet_key",
    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
).apply {
    setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
    setDigests(KeyProperties.DIGEST_SHA256)
    setUserAuthenticationRequired(true)
    setUserAuthenticationValidityDurationSeconds(30)
    setIsStrongBoxBacked(true) // Use hardware if available
}.build()

keyPairGenerator.initialize(parameterSpec)
val keyPair = keyPairGenerator.generateKeyPair()
```

#### Verifier Signing Key

- **Generation:** Secure random Ed25519 keypair
- **Storage:** Environment variable or secrets manager
- **Rotation:** Quarterly or on compromise
- **Public Key:** Hardcoded in mobile app and Solana program

```bash
# Generate new verifier key
openssl genpkey -algorithm ed25519 -outform DER | xxd -p -c 64

# Store in environment
export VERIFIER_SIGNING_KEY=<hex_encoded_key>
```

### Fraud Detection

```rust
// In Solana program

pub struct FraudRecord {
    pub bundle_id: String,
    pub reason: FraudReason,
    pub detected_at: i64,
    pub nonce: u64,
}

pub enum FraudReason {
    NonceReuse,           // Same nonce used twice
    SignatureMismatch,    // Invalid signature
    AttestationFailure,   // Attestation verification failed
    InsufficientFunds,    // Escrow balance too low
    StaleBundleHashes // Bundle hash doesn't match
}

// Detect and record fraud
if nonce_registry.used_nonces.contains(&payer_nonce) {
    nonce_registry.fraud_reports.push(FraudRecord {
        bundle_id: bundle_id.clone(),
        reason: FraudReason::NonceReuse,
        detected_at: Clock::get()?.unix_timestamp,
        nonce: payer_nonce,
    });

    // Reduce reputation
    escrow.reputation_score = escrow.reputation_score.saturating_sub(10);

    return Err(BeamError::FraudDetected.into());
}
```

## Data Flow

### Bundle Creation to Settlement

```
┌─────────────────────────────────────────────────────────────────┐
│                      Complete Data Flow                          │
└─────────────────────────────────────────────────────────────────┘

1. BUNDLE CREATION (Offline)
   Customer App:
   - Generate bundle_id (UUID)
   - Serialize bundle fields canonically
   - Hash serialized bundle (SHA-256)
   - Sign hash with Ed25519
   - Store in AsyncStorage

2. ATTESTATION GENERATION (Offline or Online)
   Customer App:
   - Generate nonce (random + bundle hash)
   - Request Play Integrity token
   - Receive signed JWT from Google
   - Sign JWT with wallet key
   - Create attestation envelope
   - Store with bundle

3. BUNDLE EXCHANGE (Offline)
   Customer → Merchant:
   - Encode bundle + attestation as QR code
   - Merchant scans QR code
   - Merchant verifies customer signature
   - Merchant generates own attestation
   - Merchant co-signs bundle
   - Both store completed bundle

4. SETTLEMENT REQUEST (Online)
   Customer App → Verifier:
   - POST /verify
   - Send bundle summary
   - Send payer attestation
   - Send merchant attestation

5. ATTESTATION VERIFICATION (Online)
   Verifier:
   - Verify JWT signatures (Google public keys)
   - Validate nonce (matches bundle)
   - Check device integrity verdicts
   - Validate app authenticity
   - Generate verifier proofs (signed roots)
   - Return proofs to customer

6. ON-CHAIN SETTLEMENT (Online)
   Customer App → Solana:
   - Call settle_offline_payment
   - Pass bundle data + verifier proofs
   - Program verifies proofs
   - Program checks nonces
   - Program verifies signatures
   - Transfer tokens escrow → merchant
   - Emit settlement event

7. CONFIRMATION (Online)
   Solana → Customer/Merchant:
   - Transaction confirmed
   - Event logs emitted
   - Balances updated
   - Both parties notified
```

## Cryptographic Design

### Ed25519 Signatures

**Properties:**
- Fast signing and verification
- Small signature size (64 bytes)
- Deterministic (same message → same signature)
- Secure against quantum attacks (for now)

**Usage in Beam:**

```typescript
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

// 1. Generate keypair
const privateKey = ed25519.utils.randomPrivateKey();
const publicKey = ed25519.getPublicKey(privateKey);

// 2. Create message to sign
const bundle = {
  bundleId: 'uuid-123',
  payer: 'CustomerPubkey',
  merchant: 'MerchantPubkey',
  amount: 10_000000,
  nonce: 1,
  timestamp: Date.now(),
};

// 3. Canonical serialization
const serialized = serializeBundle(bundle);

// 4. Hash
const hash = sha256(serialized);

// 5. Sign
const signature = ed25519.sign(hash, privateKey);

// 6. Verify
const valid = ed25519.verify(signature, hash, publicKey);
```

### Canonical Serialization

Ensures identical serialization for consistent hashing:

```typescript
function serializeBundle(bundle: OfflineBundle): Uint8Array {
  const encoder = new BorshEncoder();

  // Fixed order, fixed encoding
  encoder.encodeString(bundle.bundleId);
  encoder.encodePublicKey(bundle.payer);
  encoder.encodePublicKey(bundle.merchant);
  encoder.encodeU64(bundle.amount);
  encoder.encodeU64(bundle.nonce);
  encoder.encodeI64(bundle.timestamp);

  return encoder.toUint8Array();
}
```

### Nonce Generation

```typescript
// Combine randomness with bundle hash for unique nonce
function generateNonce(bundleHash: Uint8Array): Uint8Array {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const bundleHashPrefix = bundleHash.slice(0, 16);

  // Nonce = random || hash_prefix
  return new Uint8Array([...randomBytes, ...bundleHashPrefix]);
}
```

## State Management

### Mobile App State

```typescript
// React context for global state
interface BeamState {
  wallet: {
    publicKey: string | null;
    connected: boolean;
  };
  escrow: {
    initialized: boolean;
    balance: number;
    lastNonce: number;
  };
  bundles: {
    pending: AttestedBundle[];
    settled: AttestedBundle[];
    failed: AttestedBundle[];
  };
  network: {
    online: boolean;
    settling: boolean;
  };
}
```

### Local Storage Schema

```typescript
// AsyncStorage keys

// Bundles queue
'@beam:bundles' → JSON.stringify(bundles[])

// Wallet keypair (encrypted)
'@beam:wallet_keypair' → encrypted Ed25519 keypair

// Escrow info (cached)
'@beam:escrow_info' → { balance, lastNonce, initialized }

// Settings
'@beam:settings' → { autoSettle, biometricsEnabled }
```

## Error Handling

### Error Categories

1. **User Errors** - Invalid input, insufficient balance
2. **Network Errors** - Connection failures, timeouts
3. **Cryptographic Errors** - Signature verification failures
4. **Program Errors** - On-chain validation failures
5. **System Errors** - Unexpected exceptions

### Error Handling Strategy

```typescript
// Mobile app error handling

class BeamError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
  }
}

// Usage
try {
  await settleBundle(bundle);
} catch (error) {
  if (error instanceof BeamError) {
    if (error.recoverable) {
      // Retry later
      await bundleQueue.requeue(bundle);
    } else {
      // Move to failed queue
      await bundleQueue.markFailed(bundle, error.message);
    }

    // Show user-friendly message
    Alert.alert('Settlement Failed', error.message);
  } else {
    // Unexpected error
    console.error('Unexpected error:', error);
    Sentry.captureException(error);
  }
}
```

### Solana Program Errors

```rust
#[error_code]
pub enum BeamError {
    #[msg("Invalid nonce: must be greater than last nonce")]
    InvalidNonce,

    #[msg("Insufficient escrow balance")]
    InsufficientBalance,

    #[msg("Invalid bundle signature")]
    InvalidSignature,

    #[msg("Missing attestation proof")]
    MissingAttestation,

    #[msg("Invalid attestation")]
    InvalidAttestation,

    #[msg("Nonce already used")]
    NonceAlreadyUsed,

    #[msg("Bundle ID invalid or too long")]
    InvalidBundleId,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Fraud detected")]
    FraudDetected,

    #[msg("Arithmetic overflow")]
    Overflow,
}
```

---

For setup instructions, see [SETUP.md](./SETUP.md).

For deployment procedures, see [DEPLOYMENT.md](./DEPLOYMENT.md).
