# Attestation Quick Reference

## Quick Start

### Use Play Integrity (Recommended)

```typescript
import { attestationService } from '@/services/AttestationService';

const envelope = await attestationService.storeBundle(bundle, metadata, {
  selfRole: 'payer',
  usePlayIntegrity: true  // This is the default
});
```

### Use Key Attestation (Legacy)

```typescript
const envelope = await attestationService.storeBundle(bundle, metadata, {
  selfRole: 'merchant',
  usePlayIntegrity: false
});
```

## Configuration Checklist

### Initial Setup (One-time)

- [ ] Enable Play Integrity API in Google Cloud Console
- [ ] Link Google Cloud project to Play Console
- [ ] Get cloud project number from Cloud Console
- [ ] Add project number to `android/app/src/main/res/values/strings.xml`
- [ ] Upload app to Play Console (internal testing minimum)
- [ ] Get SHA-256 fingerprint of your signing key
- [ ] Add fingerprint to Play Console App Integrity settings
- [ ] Download Google's Play Integrity public keys
- [ ] Configure verifier with public keys

### Environment Variables (Verifier)

```bash
# Required
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_SIGNING_KEY=your_ed25519_key

# Play Integrity Keys (choose one)
VERIFIER_CERT_PEM_PATH=/path/to/keys.pem
# OR
VERIFIER_CERT_PEM="-----BEGIN CERTIFICATE-----..."

# Optional
VERIFIER_ALLOWED_DIGESTS=sha256_cert1,sha256_cert2
DEV_MODE=false
VERIFIER_ALLOW_UNSIGNED=false
```

## Getting Required Values

### Cloud Project Number

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Project number is on the dashboard

**Or:** IAM & Admin → Settings → Project number

### SHA-256 Certificate Fingerprint

```bash
# Debug keystore
keytool -list -v -keystore android/app/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android

# Release keystore
keytool -list -v -keystore /path/to/release.jks -alias your-alias
```

Look for "SHA256:" in the output.

### Play Integrity Public Keys

```bash
# Download current keys
curl https://www.googleapis.com/androidcheck/v1/attestation/publicKey \
  -o play_integrity_keys.json

# Convert to PEM format (if needed)
# Extract x5c from JSON and convert to PEM
```

### Generate Ed25519 Signing Key

```bash
# Generate new key
openssl genpkey -algorithm ed25519 -outform DER | xxd -p -c 64

# Use the output as VERIFIER_SIGNING_KEY
```

## File Locations

### Android
```
android/app/build.gradle                               # Dependencies
android/app/src/main/res/values/strings.xml           # Config
android/app/src/main/java/com/beam/app/bridge/
  SecureStorageBridgeModule.kt                        # Implementation
```

### TypeScript
```
src/native/SecureStorageBridge.ts                     # Types
src/services/AttestationService.ts                    # Service
mobile/shared/src/attestation/types.ts                # Shared types
```

### Verifier
```
verifier/src/attestation/index.ts                     # Main logic
verifier/src/attestation/google.ts                    # Play Integrity
verifier/.env                                         # Configuration
```

## Common Commands

### Build Android App

```bash
cd android
./gradlew assembleDebug
./gradlew assembleRelease
```

### Run Verifier

```bash
cd verifier
npm install
npm run dev
```

### Test Attestation

```typescript
// In your React Native code
const testAttestation = async () => {
  const bundle = createTestBundle();
  const envelope = await attestationService.storeBundle(bundle, metadata, {
    selfRole: 'payer',
    usePlayIntegrity: true
  });

  console.log('Attestation type:', envelope.attestationType);
  // Should print: "PLAY_INTEGRITY"
};
```

## Attestation Flow Diagram (Simplified)

```
App → Generate nonce + bundle hash
  ↓
App → Request Play Integrity token
  ↓
Google Play Services → Return signed JWT
  ↓
App → Sign with wallet key
  ↓
App → Send to Verifier
  ↓
Verifier → Verify JWT signature
  ↓
Verifier → Validate payload (device, app, nonce)
  ↓
Verifier → Generate proof
  ↓
Verifier → Return result
```

## Verification Checklist

What the verifier checks:

- [ ] JWT signature is valid (from Google)
- [ ] Token is recent (< 5 minutes old)
- [ ] Nonce matches expected value
- [ ] Package name is correct
- [ ] Device passed integrity checks
- [ ] App is recognized by Play Store
- [ ] APK signing certificate is allowed (if configured)

## Troubleshooting Quick Fixes

### "Cloud project number not configured"
→ Set in `strings.xml` or `SecureStorageBridgeModule.kt`

### "Play Integrity API failed"
→ Check: App in Play Console? API enabled? Project linked?

### "Verification failed"
→ Check verifier logs for specific reason

### "Package name mismatch"
→ Update `VERIFIER_EXPECTED_PACKAGE_NAME` in verifier `.env`

### "Device failed integrity checks"
→ Device may be rooted or running unofficial Android

### "App not recognized"
→ App not uploaded to Play Console, or wrong signing key

## Response Formats

### Play Integrity Attestation

```typescript
{
  bundleId: "tx_123",
  timestamp: 1697123456789,
  nonce: Uint8Array(32),           // Random bytes
  signature: Uint8Array(64),       // Ed25519 signature
  attestationReport: Uint8Array,   // JWT from Google
  certificateChain: [],            // Empty
  deviceInfo: {...},
  attestationType: "PLAY_INTEGRITY"
}
```

### Key Attestation (Legacy)

```typescript
{
  bundleId: "tx_123",
  timestamp: 1697123456789,
  nonce: Uint8Array(32),
  signature: Uint8Array(64),
  attestationReport: Uint8Array,   // Certificate
  certificateChain: [...],         // X.509 chain
  deviceInfo: {...},
  attestationType: "KEY_ATTESTATION"
}
```

## Environment-Specific Settings

### Development

```bash
DEV_MODE=true
VERIFIER_ALLOW_UNSIGNED=false
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
```

### Staging

```bash
DEV_MODE=false
VERIFIER_ALLOW_UNSIGNED=false
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app.staging
VERIFIER_ALLOWED_DIGESTS=debug_cert_sha256
```

### Production

```bash
DEV_MODE=false
VERIFIER_ALLOW_UNSIGNED=false
VERIFIER_EXPECTED_PACKAGE_NAME=com.beam.app
VERIFIER_ALLOWED_DIGESTS=release_cert_sha256
VERIFIER_CERT_PEM_PATH=/etc/beam/play_keys.pem
```

## API Reference

### AttestationService

```typescript
class AttestationService {
  // Ensure wallet key exists
  ensureWallet(): Promise<string>

  // Sign arbitrary data
  signPayload(bytes: Uint8Array, reason?: string): Promise<Uint8Array>

  // Store bundle with attestation
  storeBundle(
    bundle: OfflineBundle,
    metadata: BundleMetadata,
    options?: {
      payerAttestation?: AttestationEnvelope,
      merchantAttestation?: AttestationEnvelope,
      selfRole?: 'payer' | 'merchant',
      usePlayIntegrity?: boolean  // Default: true
    }
  ): Promise<AttestationEnvelope | undefined>

  // Load all bundles
  loadBundles(): Promise<AttestedBundle[]>

  // Remove a bundle
  removeBundle(bundleId: string): Promise<void>

  // Verify attestation envelope
  verifyEnvelope(
    envelope: AttestationEnvelope,
    bundlePayload: Uint8Array
  ): Promise<boolean>
}
```

### SecureStorageBridge (Native)

```typescript
interface SecureStorageModule {
  // Ensure wallet keypair exists
  ensureWalletKeypair(): Promise<string>

  // Sign detached (optional biometric)
  signDetached(
    payload: string,
    options?: { requireBiometrics?: boolean, reason?: string }
  ): Promise<string>

  // Store transaction
  storeTransaction(
    bundleId: string,
    payload: string,
    metadata: BundleMetadata
  ): Promise<void>

  // Fetch attestation
  fetchAttestation(
    bundleId: string,
    options?: { usePlayIntegrity?: boolean }
  ): Promise<AttestationEnvelope>

  // Other methods...
}
```

## Security Best Practices

1. **Always verify server-side** - Never trust client attestations
2. **Use fresh nonces** - New nonce for every attestation
3. **Check timestamps** - Reject old tokens
4. **Validate package name** - Prevent impersonation
5. **Monitor failures** - Track and alert on verification failures
6. **Rotate keys** - Change signing keys periodically
7. **Use StrongBox** - Enable hardware security when available
8. **Rate limit** - Prevent attestation API abuse

## Links

- [Full Implementation Guide](./PLAY_INTEGRITY_IMPLEMENTATION.md)
- [Setup Instructions](./android/PLAY_INTEGRITY_SETUP.md)
- [Play Integrity API Docs](https://developer.android.com/google/play/integrity)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Play Console](https://play.google.com/console/)

## Support

For issues or questions:
1. Check verifier logs for detailed error messages
2. Review this quick reference
3. Consult the full implementation guide
4. Check Google's Play Integrity documentation
