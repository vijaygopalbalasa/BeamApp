# BEAM - Complete Implementation Plan
**Hardware Attestation & Production Hardening**

**Date**: 2025-01-27
**Status**: Research Complete → Ready for Implementation
**Estimated Timeline**: 6-8 weeks (quality-focused, no rush)

---

## 📚 Research Summary

### Official Sources Verified
✅ **Google Root Certificates**: https://android.googleapis.com/attestation/root
✅ **Android Key Attestation Docs**: https://developer.android.com/training/articles/security-key-attestation
✅ **KeyDescription Schema**: https://source.android.com/docs/security/features/keystore/attestation
✅ **CRL (Certificate Revocation)**: https://android.googleapis.com/attestation/status

### Key Findings

1. **Two Active Root CAs**:
   - RSA Root (f92009e853b6b045): Valid 2022-2042
   - ECDSA Root (Key Attestation CA 1): Valid 2025-2035

2. **Security Levels (ASN.1 Enumeration)**:
   - 0 = Software
   - 1 = TrustedEnvironment (TEE)
   - 2 = StrongBox

3. **KeyDescription ASN.1 Structure**:
   ```asn1
   KeyDescription ::= SEQUENCE {
       attestationVersion        INTEGER,
       attestationSecurityLevel  SecurityLevel,
       keyMintVersion            INTEGER,
       keyMintSecurityLevel      SecurityLevel,
       attestationChallenge      OCTET_STRING,
       uniqueId                  OCTET_STRING,
       softwareEnforced          AuthorizationList,
       hardwareEnforced          AuthorizationList,
   }
   ```

4. **Device Info Fields (in AuthorizationList)**:
   - Tag 705: osVersion (INTEGER, format: AABBCC for A.B.C)
   - Tag 706: osPatchLevel (INTEGER, format: YYYYMMDD)
   - Tag 718: vendorPatchLevel (INTEGER, format: YYYYMMDD)
   - Tag 719: bootPatchLevel (INTEGER, format: YYYYMMDD)

---

## 🎯 PHASE 1: Hardware Attestation (Weeks 1-2)

### Week 1: Root CA & Certificate Validation

#### Task 1.1: Extract Real Root CA Fingerprints
**Goal**: Replace fake fingerprints with official Google roots

**Steps**:
1. Parse PEM certificates from Google API response
2. Calculate SHA-256 fingerprints
3. Cross-verify against multiple sources
4. Update `key-attestation.ts`

**Implementation**:
```bash
# Fetch certificates
curl https://android.googleapis.com/attestation/root > google-roots.json

# Calculate fingerprints (using openssl)
openssl x509 -in cert.pem -noout -fingerprint -sha256
```

**Expected Output**:
```typescript
const GOOGLE_ROOT_FINGERPRINTS = new Set([
  // RSA Root (f92009e853b6b045)
  '...',  // Real SHA-256 fingerprint

  // ECDSA Root (Key Attestation CA 1)
  '...',  // Real SHA-256 fingerprint
]);
```

**Acceptance Criteria**:
- ✅ Fingerprints match certificates from official API
- ✅ Cross-verified against Android source code
- ✅ Both current and future roots included

---

#### Task 1.2: Add Certificate Expiration Validation
**Goal**: Reject expired or not-yet-valid certificates

**Implementation**:
```typescript
function validateCertificateValidity(cert: x509.X509Certificate): boolean {
  const now = new Date();
  const notBefore = cert.notBefore;
  const notAfter = cert.notAfter;

  if (now < notBefore) {
    console.error(`[key-attestation] Certificate not yet valid: ${cert.subject}`);
    return false;
  }

  if (now > notAfter) {
    console.error(`[key-attestation] Certificate expired: ${cert.subject}`);
    return false;
  }

  console.log(`[key-attestation] Certificate valid: ${notBefore} - ${notAfter}`);
  return true;
}
```

**Integration Point**: `validateKeyAttestationChain()` after parsing each cert

**Acceptance Criteria**:
- ✅ Rejects certificates before notBefore date
- ✅ Rejects certificates after notAfter date
- ✅ Accepts certificates within validity period
- ✅ Logs clear error messages

---

#### Task 1.3: Add Certificate Revocation Check (Optional)
**Goal**: Check if certificates have been revoked

**Implementation**:
```typescript
async function checkCertificateRevocation(cert: x509.X509Certificate): Promise<boolean> {
  try {
    const response = await fetch('https://android.googleapis.com/attestation/status');
    const crl = await response.json();

    const serialNumber = cert.serialNumber;
    const revoked = crl.entries.find((entry: any) =>
      entry.serialNumber === serialNumber
    );

    if (revoked) {
      console.error(`[key-attestation] Certificate revoked: ${revoked.reason}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[key-attestation] CRL check failed, accepting certificate');
    return true; // Fail open (don't block if CRL unreachable)
  }
}
```

**Acceptance Criteria**:
- ✅ Checks CRL for each certificate
- ✅ Rejects revoked certificates
- ✅ Fails open if CRL unreachable
- ✅ Caches CRL for 24 hours

---

### Week 2: ASN.1 KeyDescription Parser

#### Task 2.1: Install and Setup ASN.1 Library
**Goal**: Prepare proper ASN.1 parsing tools

**Commands**:
```bash
cd verifier
pnpm add asn1js pkijs pvutils
```

**Library Documentation**:
- asn1js: https://github.com/PeculiarVentures/ASN1.js
- PKI.js: https://github.com/PeculiarVentures/PKI.js

**Acceptance Criteria**:
- ✅ Libraries installed and types working
- ✅ Can parse basic ASN.1 structures
- ✅ No build errors

---

#### Task 2.2: Implement KeyDescription Parser
**Goal**: Parse the attestation extension correctly

**Implementation**:
```typescript
import * as asn1js from 'asn1js';
import { Integer, OctetString, Sequence } from 'asn1js';

interface ParsedKeyDescription {
  attestationVersion: number;
  attestationSecurityLevel: 'SOFTWARE' | 'TEE' | 'STRONGBOX';
  keyMintVersion: number;
  keyMintSecurityLevel: 'SOFTWARE' | 'TEE' | 'STRONGBOX';
  attestationChallenge: string; // base64
  uniqueId: string; // base64
  softwareEnforced: AuthorizationList;
  hardwareEnforced: AuthorizationList;
}

function parseKeyDescriptionExtension(extensionValue: ArrayBuffer): ParsedKeyDescription | null {
  try {
    // Step 1: Decode ASN.1 BER
    const asn1 = asn1js.fromBER(extensionValue);
    if (asn1.offset === -1) {
      console.error('[key-attestation] Invalid ASN.1 encoding');
      return null;
    }

    // Step 2: Extract KeyDescription sequence
    const sequence = asn1.result as Sequence;
    if (!(sequence instanceof Sequence)) {
      console.error('[key-attestation] Expected SEQUENCE');
      return null;
    }

    const values = sequence.valueBlock.value;
    if (values.length < 8) {
      console.error('[key-attestation] Invalid KeyDescription structure');
      return null;
    }

    // Step 3: Parse fields
    const attestationVersion = (values[0] as Integer).valueBlock.valueDec;
    const attestationSecurityLevel = parseSecurityLevel((values[1] as Integer).valueBlock.valueDec);
    const keyMintVersion = (values[2] as Integer).valueBlock.valueDec;
    const keyMintSecurityLevel = parseSecurityLevel((values[3] as Integer).valueBlock.valueDec);

    const challengeOctet = values[4] as OctetString;
    const attestationChallenge = Buffer.from(challengeOctet.valueBlock.valueHex).toString('base64');

    const uniqueIdOctet = values[5] as OctetString;
    const uniqueId = Buffer.from(uniqueIdOctet.valueBlock.valueHex).toString('base64');

    const softwareEnforced = parseAuthorizationList(values[6]);
    const hardwareEnforced = parseAuthorizationList(values[7]);

    console.log('[key-attestation] ✅ KeyDescription parsed successfully', {
      attestationVersion,
      attestationSecurityLevel,
      keyMintVersion,
      keyMintSecurityLevel,
    });

    return {
      attestationVersion,
      attestationSecurityLevel,
      keyMintVersion,
      keyMintSecurityLevel,
      attestationChallenge,
      uniqueId,
      softwareEnforced,
      hardwareEnforced,
    };
  } catch (error) {
    console.error('[key-attestation] Failed to parse KeyDescription:', error);
    return null;
  }
}

function parseSecurityLevel(value: number): 'SOFTWARE' | 'TEE' | 'STRONGBOX' {
  switch (value) {
    case 0: return 'SOFTWARE';
    case 1: return 'TEE';
    case 2: return 'STRONGBOX';
    default:
      console.warn(`[key-attestation] Unknown security level: ${value}`);
      return 'SOFTWARE';
  }
}
```

**Acceptance Criteria**:
- ✅ Parses attestationVersion correctly
- ✅ Extracts attestationSecurityLevel (0/1/2 → SOFTWARE/TEE/STRONGBOX)
- ✅ Extracts attestationChallenge as base64
- ✅ Handles invalid ASN.1 gracefully
- ✅ Logs parsing errors clearly

---

#### Task 2.3: Parse AuthorizationList for Device Info
**Goal**: Extract OS version, patch levels, etc.

**Implementation**:
```typescript
interface AuthorizationList {
  osVersion?: string; // e.g., "13.0.0"
  osPatchLevel?: string; // e.g., "2024-01-15"
  vendorPatchLevel?: string; // e.g., "2024-01-10"
  bootPatchLevel?: string; // e.g., "2024-01-05"
  rootOfTrust?: {
    verifiedBootKey: string;
    deviceLocked: boolean;
    verifiedBootState: string;
  };
}

function parseAuthorizationList(asn1Value: any): AuthorizationList {
  const result: AuthorizationList = {};

  try {
    const sequence = asn1Value as Sequence;
    if (!(sequence instanceof Sequence)) {
      return result;
    }

    // AuthorizationList uses EXPLICIT context-specific tags
    for (const item of sequence.valueBlock.value) {
      const tag = item.idBlock.tagNumber;

      switch (tag) {
        case 705: // osVersion
          const osVersionInt = (item.valueBlock.value[0] as Integer).valueBlock.valueDec;
          result.osVersion = formatOsVersion(osVersionInt);
          break;

        case 706: // osPatchLevel
          const osPatchInt = (item.valueBlock.value[0] as Integer).valueBlock.valueDec;
          result.osPatchLevel = formatPatchLevel(osPatchInt);
          break;

        case 718: // vendorPatchLevel
          const vendorPatchInt = (item.valueBlock.value[0] as Integer).valueBlock.valueDec;
          result.vendorPatchLevel = formatPatchLevel(vendorPatchInt);
          break;

        case 719: // bootPatchLevel
          const bootPatchInt = (item.valueBlock.value[0] as Integer).valueBlock.valueDec;
          result.bootPatchLevel = formatPatchLevel(bootPatchInt);
          break;

        case 704: // rootOfTrust
          result.rootOfTrust = parseRootOfTrust(item.valueBlock.value[0]);
          break;
      }
    }

    console.log('[key-attestation] Device info extracted:', result);
    return result;
  } catch (error) {
    console.error('[key-attestation] Failed to parse AuthorizationList:', error);
    return result;
  }
}

function formatOsVersion(osVersionInt: number): string {
  // Format: AABBCC → A.B.C (e.g., 130000 → "13.0.0")
  const major = Math.floor(osVersionInt / 10000);
  const minor = Math.floor((osVersionInt % 10000) / 100);
  const patch = osVersionInt % 100;
  return `${major}.${minor}.${patch}`;
}

function formatPatchLevel(patchLevelInt: number): string {
  // Format: YYYYMMDD → YYYY-MM-DD (e.g., 20240115 → "2024-01-15")
  const str = patchLevelInt.toString().padStart(8, '0');
  const year = str.substring(0, 4);
  const month = str.substring(4, 6);
  const day = str.substring(6, 8);
  return `${year}-${month}-${day}`;
}

function parseRootOfTrust(sequence: Sequence): any {
  // TODO: Implement RootOfTrust parsing
  // Contains: verifiedBootKey, deviceLocked, verifiedBootState
  return {};
}
```

**Acceptance Criteria**:
- ✅ Extracts osVersion and formats correctly (e.g., "13.0.0")
- ✅ Extracts all patch levels and formats as YYYY-MM-DD
- ✅ Handles missing fields gracefully
- ✅ Logs extracted device info

---

#### Task 2.4: Integrate Parser into Validation Flow
**Goal**: Replace mocked parsing with real implementation

**Changes to `key-attestation.ts`**:
```typescript
export async function validateKeyAttestationChain(
  certificateChain: string[],
  expectedChallenge: string
): Promise<KeyAttestationValidationResult> {
  // ... existing validation ...

  // ========== Step 5: Extract attestation extension from leaf certificate ==========
  const leafCert = certs[0];
  const attestationExtension = getAttestationExtension(leafCert);

  if (!attestationExtension) {
    console.error('[key-attestation] No attestation extension found');
    return { valid: false, reason: 'missing_attestation_extension' };
  }

  // ========== Step 6: Parse attestation extension with REAL parser ==========
  const keyDescription = parseKeyDescriptionExtension(attestationExtension);

  if (!keyDescription) {
    console.error('[key-attestation] Failed to parse KeyDescription');
    return { valid: false, reason: 'attestation_extension_parse_error' };
  }

  console.log('[key-attestation] KeyDescription:', {
    version: keyDescription.attestationVersion,
    securityLevel: keyDescription.attestationSecurityLevel,
    osVersion: keyDescription.hardwareEnforced.osVersion,
    osPatchLevel: keyDescription.hardwareEnforced.osPatchLevel,
  });

  // ========== Step 7: Verify challenge matches ==========
  const challengeBuffer = Buffer.from(expectedChallenge, 'base64');
  const attestedChallengeBuffer = Buffer.from(keyDescription.attestationChallenge, 'base64');

  if (!challengeBuffer.equals(attestedChallengeBuffer)) {
    console.error('[key-attestation] Challenge mismatch', {
      expected: expectedChallenge.substring(0, 32),
      attested: keyDescription.attestationChallenge.substring(0, 32),
    });
    return { valid: false, reason: 'challenge_mismatch' };
  }

  console.log('[key-attestation] ✅ Challenge verified');

  // ========== Step 8: Validate device info ==========
  if (!validateDeviceInfo(keyDescription.hardwareEnforced)) {
    return { valid: false, reason: 'device_info_invalid' };
  }

  // ========== Success ==========
  return {
    valid: true,
    securityLevel: keyDescription.attestationSecurityLevel,
    challenge: keyDescription.attestationChallenge,
    deviceInfo: {
      osVersion: parseOsVersionNumber(keyDescription.hardwareEnforced.osVersion),
      osPatchLevel: parsePatchLevelNumber(keyDescription.hardwareEnforced.osPatchLevel),
      vendorPatchLevel: parsePatchLevelNumber(keyDescription.hardwareEnforced.vendorPatchLevel),
      bootPatchLevel: parsePatchLevelNumber(keyDescription.hardwareEnforced.bootPatchLevel),
    },
  };
}

function validateDeviceInfo(authList: AuthorizationList): boolean {
  // Validate OS patch level is not too old (e.g., within 3 months)
  if (authList.osPatchLevel) {
    const patchDate = new Date(authList.osPatchLevel);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    if (patchDate < threeMonthsAgo) {
      console.warn('[key-attestation] ⚠️ OS patch level is outdated:', authList.osPatchLevel);
      // Don't reject, just warn
    }
  }

  return true; // For now, accept all device info
}
```

**Acceptance Criteria**:
- ✅ Parsing integrated into main validation flow
- ✅ Challenge verification uses parsed value
- ✅ Security level uses parsed value
- ✅ Device info returned in validation result
- ✅ Old mocked parsing completely removed

---

### Testing Week 2

#### Task 2.5: Test with Real Device Certificates
**Goal**: Verify implementation works with actual Android attestation

**Test Steps**:
1. Generate attestation on real Android device
2. Extract certificate chain
3. Send to verifier
4. Verify parsing succeeds
5. Verify all fields extracted correctly

**Test Script**:
```typescript
// verifier/test/attestation-real-device.test.ts
import { validateKeyAttestationChain } from '../src/attestation/key-attestation';

describe('Real Device Attestation', () => {
  it('should validate real StrongBox attestation', async () => {
    // Certificate chain from real device (replace with actual)
    const certChain = [
      'MIIBxz...', // Leaf cert with attestation extension
      'MIIByz...', // Intermediate
      'MIICIj...', // Root
    ];

    const challenge = 'base64-encoded-32-byte-challenge';

    const result = await validateKeyAttestationChain(certChain, challenge);

    expect(result.valid).toBe(true);
    expect(result.securityLevel).toBe('STRONGBOX');
    expect(result.challenge).toBe(challenge);
    expect(result.deviceInfo?.osVersion).toBeGreaterThan(0);
    expect(result.deviceInfo?.osPatchLevel).toBeGreaterThan(0);
  });

  it('should reject certificate with wrong challenge', async () => {
    const certChain = [ /* ... */ ];
    const wrongChallenge = 'different-challenge';

    const result = await validateKeyAttestationChain(certChain, wrongChallenge);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('challenge_mismatch');
  });

  it('should reject expired certificate', async () => {
    // Use certificate that has expired
    const expiredCertChain = [ /* ... */ ];
    const challenge = '...';

    const result = await validateKeyAttestationChain(expiredCertChain, challenge);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });
});
```

**Acceptance Criteria**:
- ✅ All tests pass with real device certificates
- ✅ StrongBox devices detected correctly
- ✅ TEE devices detected correctly
- ✅ Challenge verification works
- ✅ Device info parsed correctly

---

## 🔐 PHASE 2: Verifier Security (Weeks 3-4)

### Week 3: Authentication & Rate Limiting

#### Task 3.1: Add API Key Authentication
**Goal**: Prevent unauthorized access to verifier

**Implementation**:
```typescript
// verifier/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

const VALID_API_KEYS = new Set([
  process.env.API_KEY_MOBILE_APP,
  process.env.API_KEY_ADMIN,
]);

export function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing API key',
    });
  }

  if (!VALID_API_KEYS.has(apiKey)) {
    console.warn('[auth] Invalid API key attempt:', {
      ip: req.ip,
      key: apiKey.substring(0, 8) + '...',
    });
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid API key',
    });
  }

  next();
}
```

**Integration**:
```typescript
// verifier/src/index.ts
import { authenticateApiKey } from './middleware/auth';

// Apply to all attestation endpoints
app.post('/api/attestation/request', authenticateApiKey, async (req, res) => {
  // ... existing code ...
});

// Health endpoint is public (no auth)
app.get('/health', async (req, res) => {
  res.json({ status: 'ok' });
});
```

**Environment Variables**:
```bash
# verifier/.env
API_KEY_MOBILE_APP=beam_mobile_app_key_abc123def456
API_KEY_ADMIN=beam_admin_key_xyz789uvw012
```

**Mobile App Integration**:
```typescript
// mobile/beam-app/src/services/VerifierService.ts
const API_KEY = process.env.VERIFIER_API_KEY || 'beam_mobile_app_key_abc123def456';

async requestAttestation(data: any): Promise<any> {
  const response = await fetch(`${VERIFIER_URL}/api/attestation/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(data),
  });

  if (response.status === 401) {
    throw new Error('Verifier authentication failed');
  }

  return response.json();
}
```

**Acceptance Criteria**:
- ✅ Requests without API key are rejected (401)
- ✅ Requests with invalid API key are rejected (401)
- ✅ Requests with valid API key are accepted
- ✅ Health endpoint remains public
- ✅ Mobile app can authenticate successfully

---

#### Task 3.2: Add Rate Limiting
**Goal**: Prevent abuse and DoS attacks

**Implementation**:
```typescript
// verifier/src/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

// Create Redis client (for Vercel, use Upstash Redis)
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.connect().catch(console.error);

// Attestation endpoint: 10 requests per minute per IP
export const attestationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:attestation:',
  }),
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later',
  },
});

// Health endpoint: 60 requests per minute per IP
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Integration**:
```typescript
// verifier/src/index.ts
import { attestationLimiter, healthLimiter } from './middleware/rate-limit';

app.post('/api/attestation/request',
  attestationLimiter,
  authenticateApiKey,
  async (req, res) => {
    // ... existing code ...
  }
);

app.get('/health', healthLimiter, async (req, res) => {
  res.json({ status: 'ok' });
});
```

**Acceptance Criteria**:
- ✅ 11th request within 1 minute is rejected (429)
- ✅ Rate limit resets after window expires
- ✅ Different IPs have separate limits
- ✅ Rate limit headers included in response
- ✅ Redis store persists across Vercel deployments

---

#### Task 3.3: Restrict CORS
**Goal**: Only allow requests from authorized origins

**Implementation**:
```typescript
// verifier/src/middleware/cors.ts
import cors from 'cors';

const ALLOWED_ORIGINS = [
  'https://beam-app.vercel.app',
  'https://beam.app',
  'com.beam.app', // React Native
  'http://localhost:3000', // Local development
];

export const corsOptions = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[cors] Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
});
```

**Integration**:
```typescript
// verifier/src/index.ts
import { corsOptions } from './middleware/cors';

app.use(corsOptions);
```

**Acceptance Criteria**:
- ✅ Requests from allowed origins succeed
- ✅ Requests from unauthorized origins blocked
- ✅ React Native requests (no origin) allowed
- ✅ Local development allowed

---

### Week 4: Key Rotation & Database

#### Task 4.1: Rotate Verifier Signing Key
**Goal**: Deploy fresh keys, remove defaults

**Steps**:
1. Generate new Ed25519 keypair
2. Deploy to Vercel environment variables
3. Remove default key from source code
4. Update Solana program (if needed)

**Key Generation**:
```bash
# Generate new Ed25519 keypair
node -e "
const nacl = require('tweetnacl');
const keypair = nacl.sign.keyPair();
console.log('Private Key:', Buffer.from(keypair.secretKey).toString('hex'));
console.log('Public Key:', Buffer.from(keypair.publicKey).toString('hex'));
"
```

**Verifier Update**:
```typescript
// verifier/src/env.ts
const VERIFIER_SIGNING_KEY = process.env.VERIFIER_SIGNING_KEY;

if (!VERIFIER_SIGNING_KEY) {
  throw new Error('VERIFIER_SIGNING_KEY environment variable is required');
}

export const VERIFIER_PRIVATE_KEY = Buffer.from(VERIFIER_SIGNING_KEY, 'hex');
export const VERIFIER_PUBLIC_KEY = VERIFIER_PRIVATE_KEY.slice(32); // Ed25519 public key
```

**Deployment**:
```bash
# Set environment variable on Vercel
vercel env add VERIFIER_SIGNING_KEY production

# Paste the private key (hex format)
```

**Acceptance Criteria**:
- ✅ New keys generated securely
- ✅ Deployed to Vercel (not in code)
- ✅ Verifier fails to start without key
- ✅ Old default key removed from git
- ✅ Attestation signing works with new key

---

#### Task 4.2: Implement Database for Relay Storage
**Goal**: Replace in-memory storage with persistent database

**Option A: Vercel Postgres** (Recommended)
```bash
# Install Vercel Postgres SDK
pnpm add @vercel/postgres
```

**Schema**:
```sql
CREATE TABLE bundles (
  id SERIAL PRIMARY KEY,
  bundle_id VARCHAR(64) UNIQUE NOT NULL,
  payer_pubkey VARCHAR(44) NOT NULL,
  merchant_pubkey VARCHAR(44) NOT NULL,
  bundle_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_payer (payer_pubkey),
  INDEX idx_merchant (merchant_pubkey),
  INDEX idx_expires (expires_at)
);
```

**Implementation**:
```typescript
// verifier/src/relay/database.ts
import { sql } from '@vercel/postgres';

export async function storeBundle(
  bundleId: string,
  payerPubkey: string,
  merchantPubkey: string,
  bundleData: any
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day TTL

  await sql`
    INSERT INTO bundles (bundle_id, payer_pubkey, merchant_pubkey, bundle_data, expires_at)
    VALUES (${bundleId}, ${payerPubkey}, ${merchantPubkey}, ${JSON.stringify(bundleData)}, ${expiresAt})
    ON CONFLICT (bundle_id) DO UPDATE
    SET bundle_data = ${JSON.stringify(bundleData)}
  `;
}

export async function getBundlesByPubkey(pubkey: string): Promise<any[]> {
  const result = await sql`
    SELECT bundle_data
    FROM bundles
    WHERE (payer_pubkey = ${pubkey} OR merchant_pubkey = ${pubkey})
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 100
  `;

  return result.rows.map((row: any) => row.bundle_data);
}

export async function cleanupExpiredBundles(): Promise<number> {
  const result = await sql`
    DELETE FROM bundles
    WHERE expires_at < NOW()
  `;

  return result.rowCount || 0;
}
```

**Integration**:
```typescript
// verifier/src/relay/index.ts
import { storeBundle, getBundlesByPubkey } from './database';

// Replace Map with database calls
export async function uploadBundle(bundle: any): Promise<void> {
  await storeBundle(
    bundle.tx_id,
    bundle.payer_pubkey,
    bundle.merchant_pubkey,
    bundle
  );
}

export async function downloadBundles(pubkey: string): Promise<any[]> {
  return await getBundlesByPubkey(pubkey);
}
```

**Scheduled Cleanup** (Vercel Cron):
```typescript
// verifier/api/cron/cleanup.ts
import { cleanupExpiredBundles } from '../../src/relay/database';

export default async function handler(req: Request) {
  const deleted = await cleanupExpiredBundles();
  return new Response(JSON.stringify({ deleted }), { status: 200 });
}
```

```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/cleanup",
    "schedule": "0 2 * * *"
  }]
}
```

**Acceptance Criteria**:
- ✅ Bundles persist across Vercel restarts
- ✅ Expired bundles auto-deleted daily
- ✅ Query performance <100ms
- ✅ 100 bundle limit per pubkey enforced
- ✅ Handles concurrent writes safely

---

## 🔧 PHASE 3: Program & Hash Fixes (Week 5)

### Task 5.1: Fix Hash Function Mismatch
**Goal**: Standardize on SHA256 everywhere

**Rust Program Update**:
```rust
// program/programs/program/src/attestation.rs
use solana_program::hash::hashv;  // REMOVE THIS
use solana_program::hash::hash;   // ADD THIS

// OLD (SHA512):
let root_hash = hashv(&[/* ... */]);

// NEW (SHA256):
let root_hash = hash(&[/* ... */]);
```

**Test Update**:
```typescript
// program/tests/attestation-helper.ts
import { createHash } from 'crypto';

export function computeAttestationRoot(input: AttestationRootInput): Buffer {
  const preimage = Buffer.concat([
    PREFIX,
    bundleIdBytes,
    payerPubkey,
    merchantPubkey,
    amountBytes,
    nonceBytes,
    roleBytes,
    attestationNonce,
    timestampBytes,
  ]);

  // Use SHA256 (not SHA512!)
  return createHash('sha256').update(preimage).digest();
}
```

**Verifier Update**:
```typescript
// verifier/src/attestation/index.ts
import { sha256 } from '@noble/hashes/sha256';

function computeAttestationRoot(input: AttestationRootInput): Uint8Array {
  const preimage = concatBytes(/* ... */);
  return sha256(preimage); // Already using SHA256 ✓
}
```

**Acceptance Criteria**:
- ✅ All three components use SHA256
- ✅ Hash values match byte-for-byte
- ✅ Tests pass with real attestations
- ✅ On-chain verification succeeds

---

### Task 5.2: PDA-based Verifier Authority (Advanced)
**Goal**: Allow verifier key rotation without program upgrade

**Implementation**:
```rust
// program/programs/program/src/state.rs
#[account]
pub struct VerifierAuthority {
    pub public_key: Pubkey,
    pub updated_at: i64,
    pub admin: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeVerifier<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8 + 32 + 1,
        seeds = [b"verifier"],
        bump
    )]
    pub verifier: Account<'info, VerifierAuthority>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateVerifier<'info> {
    #[account(
        mut,
        seeds = [b"verifier"],
        bump = verifier.bump,
        constraint = verifier.admin == admin.key()
    )]
    pub verifier: Account<'info, VerifierAuthority>,

    pub admin: Signer<'info>,
}

// Instructions
pub fn initialize_verifier(ctx: Context<InitializeVerifier>, new_pubkey: Pubkey) -> Result<()> {
    let verifier = &mut ctx.accounts.verifier;
    verifier.public_key = new_pubkey;
    verifier.updated_at = Clock::get()?.unix_timestamp;
    verifier.admin = ctx.accounts.admin.key();
    verifier.bump = ctx.bumps.verifier;
    Ok(())
}

pub fn update_verifier(ctx: Context<UpdateVerifier>, new_pubkey: Pubkey) -> Result<()> {
    let verifier = &mut ctx.accounts.verifier;
    verifier.public_key = new_pubkey;
    verifier.updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}
```

**Attestation Verification Update**:
```rust
// program/programs/program/src/attestation.rs
pub fn verify_attestation_signature(
    root: &[u8],
    signature: &[u8],
    verifier_authority: &Account<VerifierAuthority>, // From PDA
) -> Result<()> {
    let pubkey_bytes = verifier_authority.public_key.to_bytes();

    // Verify Ed25519 signature
    ed25519_verify(signature, root, &pubkey_bytes)
        .map_err(|_| ErrorCode::InvalidAttestationSignature)?;

    Ok(())
}
```

**Acceptance Criteria**:
- ✅ Verifier PDA created successfully
- ✅ Admin can update verifier key
- ✅ Non-admin cannot update
- ✅ Attestation verification uses PDA key
- ✅ Key rotation tested successfully

---

## 📱 PHASE 4: Mobile App Polish (Week 6)

### Task 6.1: Fix TypeScript Errors
**Goal**: Clean up all ~37 TypeScript compilation errors

**Process**:
```bash
cd mobile/beam-app
pnpm exec tsc --noEmit > typescript-errors.txt
```

**Common Fixes**:
1. Add missing type definitions
2. Update Solana/SPL Token imports (v1 → v2)
3. Add missing @react-native-community/netinfo
4. Fix optional prop types

**Acceptance Criteria**:
- ✅ `tsc --noEmit` returns 0 errors
- ✅ IntelliSense works correctly
- ✅ App still builds and runs

---

### Task 6.2: Add Network Status Indicator
**Goal**: Show online/offline status to user

**Implementation**:
```typescript
// mobile/beam-app/src/components/NetworkStatus.tsx
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected === true);
    });

    return unsubscribe;
  }, []);

  if (isOnline) return null;

  return (
    <View style={styles.offlineBanner}>
      <Text>⚠️ You are offline. Payments will be settled when you reconnect.</Text>
    </View>
  );
}
```

**Acceptance Criteria**:
- ✅ Shows banner when offline
- ✅ Hides when online
- ✅ Auto-detects network changes

---

### Task 6.3: Add Balance Validation & Alerts
**Goal**: Prevent creating payments without sufficient balance

**Implementation in CustomerScreen.tsx**:
```typescript
const createPayment = async (amount: number) => {
  // Check escrow balance
  const escrowBalance = await beamClient.getEscrowBalance(walletPubkey);

  if (escrowBalance < amount) {
    Alert.alert(
      'Insufficient Balance',
      `You need ${amount / 1_000_000} USDC in escrow but only have ${escrowBalance / 1_000_000} USDC.\\n\\nPlease add more funds to your escrow account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add Funds', onPress: () => navigation.navigate('EscrowSetup') },
      ]
    );
    return;
  }

  // Warn if low balance
  const LOW_BALANCE_THRESHOLD = 10_000_000; // 10 USDC
  if (escrowBalance - amount < LOW_BALANCE_THRESHOLD) {
    Alert.alert(
      'Low Balance Warning',
      `After this payment, you'll have ${(escrowBalance - amount) / 1_000_000} USDC remaining.`
    );
  }

  // Proceed with payment
  // ...
};
```

**Acceptance Criteria**:
- ✅ Blocks payments with insufficient balance
- ✅ Warns when balance low
- ✅ Suggests adding funds
- ✅ Shows clear error messages

---

## ✅ Testing & QA (Week 7)

### End-to-End Testing
1. **Hardware Attestation Flow**:
   - Generate attestation on 3 different devices (StrongBox, TEE, Software)
   - Verify all parse correctly
   - Verify challenge validation works

2. **Complete Payment Flow**:
   - Customer creates payment (offline)
   - Sends via BLE to merchant
   - Both fetch attestations
   - Merchant settles on-chain
   - Verify USDC transferred

3. **Security Testing**:
   - Try fake attestations (should reject)
   - Try expired certificates (should reject)
   - Try wrong challenge (should reject)
   - Try rate limit bypass (should block)

4. **Performance Testing**:
   - 100 attestation requests/minute (should handle)
   - Database with 10,000 bundles (should be fast)
   - BLE transmission with 4KB bundle (should work)

---

## 📦 Deployment (Week 8)

### Pre-Deployment Checklist
- [ ] All tests passing
- [ ] TypeScript errors = 0
- [ ] Security audit complete
- [ ] Documentation updated
- [ ] Environment variables configured

### Deployment Steps

1. **Verifier to Vercel**:
```bash
cd verifier
pnpm build
vercel --prod

# Set environment variables
vercel env add VERIFIER_SIGNING_KEY production
vercel env add API_KEY_MOBILE_APP production
vercel env add REDIS_URL production
```

2. **Solana Program**:
```bash
cd program
anchor build
anchor deploy --provider.cluster devnet

# Or mainnet:
anchor deploy --provider.cluster mainnet-beta
```

3. **Mobile App**:
```bash
cd mobile/beam-app/android
./gradlew clean
./gradlew assembleRelease

# APK at: android/app/build/outputs/apk/release/app-release.apk
```

---

## 📊 Success Metrics

After implementation:
- ✅ Hardware attestation: Real root CAs, proper ASN.1 parsing
- ✅ Security: API keys, rate limiting, key rotation
- ✅ Reliability: Database storage, no data loss
- ✅ UX: Network status, balance checks, clear errors
- ✅ Code Quality: 0 TypeScript errors
- ✅ Production Ready: 95%+ overall score

**End Goal**: Production-grade, secure, user-friendly offline payment system

---

**Next Steps**: Start implementing Phase 1, Week 1, Task 1.1 ✅
