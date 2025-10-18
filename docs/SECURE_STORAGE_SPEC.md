# Secure Storage & Attestation Spec

## Goals
- Keys never leave hardware-backed stores (Seed Vault, StrongBox, Secure Enclave)
- Offline transaction log sealed in TEE storage with integrity + confidentiality
- Every offline transaction accompanied by hardware attestation proof verifiable on-chain

## Interfaces

### JavaScript -> Native Bridge (`SecureStorageBridge`)
```ts
export interface SecureStorageBridge {
  ensureWalletKeypair(): Promise<string>; // returns base58 pubkey
  signDetached(payload: Uint8Array, options?: SignOptions): Promise<Uint8Array>;
  storeTransaction(bundleId: string, payload: Uint8Array, metadata: BundleMetadata): Promise<void>;
  loadTransactions(): Promise<StoredBundle[]>;
  removeTransaction(bundleId: string): Promise<void>;
  clearAll(): Promise<void>;
  fetchAttestation(bundleId: string): Promise<AttestationEnvelope>;
}
```

### Attestation Envelope
```ts
interface AttestationEnvelope {
  bundleId: string;
  timestamp: number;
  teeReport: Uint8Array; // device-specific attestation blob
  certificateChain: Uint8Array[];
  nonce: string; // random challenge binding request
  signature: Uint8Array; // signature over bundle hash + nonce
  deviceInfo: {
    manufacturer: string;
    model: string;
    osVersion: string;
    securityPatch: string;
  };
}
```

### Platform Implementations

#### Android (Kotlin)
- Use `BiometricPrompt` + `KeyGenParameterSpec` with `setIsStrongBoxBacked(true)` when available
- Use `KeyPairGenerator` for Ed25519 or ECDSA keys (Android 13+) or fallback to curve25519 libs within TEE
- Transaction storage via `EncryptedFile` (Jetpack Security) with master key `MasterKey.Builder(context).setUserAuthenticationRequired(true)`
- Attestation via `KeyInfo#getKeyMaterial` + `KeyAttestationApplicationId`, or Play Integrity API for device integrity
- Provide protobuf attestation format (SafetyNet `JWS`) decoded to `AttestationEnvelope`

#### Solana Mobile (Seed Vault)
- Use `MobileWalletAdapter` RPC to request signing operations
- Store transaction log via Android secure storage + offline DB sealed with Seed Vault session keys
- Attestation through Solana Mobile `AttestationClient` (if available) or integrate Google Play Integrity on Saga

#### iOS (Future)
- Use Secure Enclave keys + `SecKeyCopyAttestationKey` (iOS 17+) or DeviceCheck API

## Verification Flow
1. Bundle created and signed by payer + merchant via TEE-backed `signDetached`
2. `SecureStorageBridge.storeTransaction` persists encrypted payload and triggers attestation retrieval -> returns `AttestationEnvelope`
3. When settling, client sends bundle + both envelopes to Anchor program
4. Program performs:
   - Verify signatures over bundle
   - Validate nonce ordering
   - Parse attestation JWS, verify certificate chain rooted in Google/Apple
   - Check nonce binding and timestamp freshness
   - Ensure device integrity claims (CTS profile match, basic integrity)
   - Persist attestation hash in state (replay protection)

## Data Retention
- Limit stored transactions to last N (configurable) once settled
- Provide export API for audit (encrypted zip signed by device key)

## Testing Strategy
- Unit tests for envelope encode/decode (shared lib)
- Mock native bridge for React Native tests
- Android instrumentation tests for key generation + attestation
- Anchor tests with fixture attestation data (signed JWS from dev keys)

