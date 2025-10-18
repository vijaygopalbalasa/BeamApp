# Mesh Pay Production Roadmap

## Goals

- Offline-first P2P payments with dual signatures, TEE-backed storage, and attestation proofs
- QR + Bluetooth mesh connectivity between customer and merchant devices without central validators
- Solana settlement contract verifies signatures, hardware attestation, nonce registry, and handles dispute/fraud proofs
- Price stability with USDC primary flow and SOL fallback using cached price + oracle reconciliation

## Current State Summary

- React Native app handles wallet setup, escrow funding, customer + merchant flows, QR interactions
- Offline bundles generated in shared TypeScript lib with Ed25519 signatures
- Anchor program maintains escrow PDA, enforces nonce ordering, handles SPL token transfers
- BLE service stubbed (no mesh/peripheral mode), no secure enclave integration, no attestation pipeline
- On-chain program lacks attestation verification, reputation, batch settlement, fraud proof logic
- Storage uses AsyncStorage; no TEE/Seed Vault integration; wallet keys stored via React Native Keychain
- No integration tests, limited lint/tests, no CI

## Workstreams

### 1. Secure Key + Transaction Storage
- Introduce platform abstraction:
  - Android: wrap Jetpack Security + StrongBox/Keystore APIs
  - Solana Mobile: integrate Seed Vault & Mobile Wallet Adapter
  - iOS (if needed): Secure Enclave keychain
- Transaction log stored via native module bridging to TEE (AES-GCM sealed storage)
- Implement attestation fetch via Play Integrity / SafetyNet, expose to JS layer
- Shared data format: offline bundle + attestation envelope (CBOR/JSON)
- Unit tests for serialization + verification

### 2. Connectivity Layer (BLE Mesh + QR)
- Implement BLE peripheral/central roles using native modules (react-native-ble-plx insufficient for advertising)
- Mesh gossip protocol: store-and-forward, TTL, dedup, optional witnesses
- Fallback direct P2P handshake with presence discovery, auto-retry
- QR flow remains for manual exchange
- Testing harness using mock BLE layer for CI

### 3. Settlement + Fraud Prevention Smart Contract
- Extend on-chain state:
  - `nonce_registry`, `attestation_validators`, `reputation_scores`, `pending_settlements`
- Functions: `settle_offline_transaction`, `verify_tee_attestation`, `submit_fraud_proof`, `batch_settle`
- Integrate Pyth/Switchboard oracle adapter for SOL fallback mode
- Add attestation signature verification (Google root cert chain, manufacturer certs)
- Anchor tests covering: valid settlement, double-spend rejection, invalid attestation, conflict resolution

### 4. Client Settlement Service Upgrade
- Maintain attestation envelopes per bundle
- Handle price reconciliation: USDC default, SOL fallback with cached price metadata and on-chain corrected settle
- Background sync worker (Headless JS) detecting connectivity, auto-settlement, retries
- Detailed error UX + logs

### 5. Observability & Tooling
- Add logging & analytics (structured logs)
- CLI for inspecting offline bundle store, verifying signatures locally
- Integration tests simulating offline -> online settlement path
- CI pipeline for lint/tests/builds (GitHub Actions)

### 6. Documentation & Compliance
- Architecture docs, threat model, data protection policy
- Play Store compliance (permissions, background usage)
- Disaster recovery / manual settlement procedures

## Immediate Next Steps
1. Define secure storage/attestation interfaces and spike native module requirements
2. Draft updated Anchor IDL + state structs
3. Plan BLE mesh native module approach / evaluate existing libs
4. Deliver initial PoC for attested bundle verification off-chain (Node verifier)


## Module Sketches

### Shared (TypeScript)
- `mobile/shared/src/attestation/types.ts`: AttestationEnvelope, DeviceInfo, VerificationResult
- `mobile/shared/src/attestation/encoder.ts`: canonical CBOR encoding, hash helpers
- `mobile/shared/src/network/mesh.ts`: protocol constants, message envelope definitions

### Mobile Client
- `mobile/beam-app/src/native/SecureStorage.ts`: platform bridge for TEE log + attestation retrieval
- `mobile/beam-app/src/services/AttestationService.ts`: orchestrates call flow, caches attestations, verifies before settlement
- `mobile/beam-app/src/services/MeshNetworkService.ts`: BLE mesh interface (wrapping native module)
- `mobile/beam-app/src/workers/SettlementWorker.ts`: headless background worker for sync
- `mobile/beam-app/src/state/ReputationStore.ts`: track local reputations and fraud flags

### Anchor Program
- New account: `MeshPayState` storing nonce registry, validators, metrics
- Instruction handlers:
  - `initialize_state` (admin) / `update_attestation_validator`
  - `settle_offline_transaction`
  - `submit_fraud_proof`
  - `batch_settle`
- Attestation verification helper invoking Google root cert verification using ed25519/secp (blst?)
- Event structs for settlement, fraud proof, validator updates

### Tooling
- `verifier/src/attestationVerifier.ts`: Node service to validate attestation envelopes
- `scripts/mock-attestation.ts`: fixture generator for tests
- Github Actions workflow for lint/test/build across packages

