import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  VERIFIER_EXPECT_PACKAGE,
  VERIFIER_ALLOWED_DIGEST,
  VERIFIER_ALLOW_DEV,
} from '../env';

const CERT_PEM_PATH = process.env.VERIFIER_CERT_PEM_PATH;
const CERT_PEM_INLINE = process.env.VERIFIER_CERT_PEM;

function loadCertificates(): string[] {
  const certs: string[] = [];

  if (CERT_PEM_INLINE) {
    certs.push(...CERT_PEM_INLINE.split('-----END CERTIFICATE-----').filter(Boolean).map(chunk => `${chunk.trim()}\n-----END CERTIFICATE-----`));
  }

  if (CERT_PEM_PATH) {
    try {
      const content = fs.readFileSync(path.resolve(CERT_PEM_PATH), 'utf-8');
      const matches = content.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g);
      if (matches) {
        certs.push(...matches);
      }
    } catch (err) {
      console.error('[verifier] Failed to read certificate path', err);
    }
  }

  return certs;
}

const cachedCerts = loadCertificates();

export interface IntegrityPayload {
  nonce?: string;
  timestampMillis?: string | number;
  apkPackageName?: string;
  apkDigestSha256?: string;
  basicIntegrity?: boolean;
  ctsProfileMatch?: boolean;
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[];
  };
  accountDetails?: {
    appLicensingVerdict?: string;
  };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    certificateSha256Digest?: string[];
    versionCode?: string;
  };
}

export async function verifyPlayIntegrityJWS(jws: string): Promise<IntegrityPayload | null> {
  if (!jws) {
    return null;
  }

  const parts = jws.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const headerJson = Buffer.from(encodedHeader, 'base64').toString('utf8');
  const payloadJson = Buffer.from(encodedPayload, 'base64').toString('utf8');

  let header: any;
  try {
    header = JSON.parse(headerJson);
  } catch (err) {
    return null;
  }

  if (header?.alg !== 'RS256') {
    return null;
  }

  const signature = Buffer.from(encodedSignature, 'base64');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const certs = cachedCerts;
  if (certs.length === 0 && !VERIFIER_ALLOW_DEV) {
    console.warn('[verifier] No certificates provided for attestation verification');
    return null;
  }

  const verified = certs.some(cert => {
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(signingInput);
      verifier.end();
      return verifier.verify(cert, signature);
    } catch (err) {
      return false;
    }
  });

  if (!verified) {
    if (VERIFIER_ALLOW_DEV) {
      console.warn('[verifier] signature verification failed, dev mode allows bypass');
    } else {
      return null;
    }
  }

  try {
    return JSON.parse(payloadJson) as IntegrityPayload;
  } catch (err) {
    return null;
  }
}

export function validateIntegrityPayload(payload: IntegrityPayload, expectedNonce?: string): boolean {
  if (!payload) {
    return false;
  }

  // Validate nonce if provided
  if (expectedNonce && payload.nonce && payload.nonce !== expectedNonce) {
    console.warn('[verifier] Nonce mismatch in Play Integrity payload');
    return false;
  }

  // Check timestamp is recent (within last 5 minutes)
  if (payload.timestampMillis) {
    const tokenTime = typeof payload.timestampMillis === 'string'
      ? parseInt(payload.timestampMillis, 10)
      : payload.timestampMillis;
    const now = Date.now();
    const age = now - tokenTime;
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (age > maxAge || age < 0) {
      console.warn('[verifier] Play Integrity token timestamp out of acceptable range');
      return false;
    }
  }

  // Validate package name (new format)
  const packageName = payload.appIntegrity?.packageName || payload.apkPackageName;
  if (VERIFIER_EXPECT_PACKAGE && packageName && packageName !== VERIFIER_EXPECT_PACKAGE) {
    console.warn('[verifier] Package name mismatch:', packageName, 'expected:', VERIFIER_EXPECT_PACKAGE);
    return false;
  }

  // Check device integrity (new format preferred, fallback to legacy)
  const hasDeviceIntegrity = payload.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_DEVICE_INTEGRITY') ||
                              payload.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_BASIC_INTEGRITY') ||
                              payload.deviceIntegrity?.deviceRecognitionVerdict?.includes('MEETS_STRONG_INTEGRITY');

  const hasLegacyIntegrity = payload.basicIntegrity || payload.ctsProfileMatch;

  if (!hasDeviceIntegrity && !hasLegacyIntegrity) {
    console.warn('[verifier] Device failed integrity checks');
    return false;
  }

  // Validate app integrity
  if (payload.appIntegrity?.appRecognitionVerdict) {
    const verdict = payload.appIntegrity.appRecognitionVerdict;
    if (verdict !== 'PLAY_RECOGNIZED' && verdict !== 'UNRECOGNIZED_VERSION') {
      console.warn('[verifier] App not recognized by Play:', verdict);
      // Note: UNRECOGNIZED_VERSION is allowed for apps not yet published
      // or uploaded to internal testing
      if (!VERIFIER_ALLOW_DEV) {
        return false;
      }
    }
  }

  // Validate APK digest (new format)
  const digestsToCheck = payload.appIntegrity?.certificateSha256Digest ||
                         (payload.apkDigestSha256 ? [payload.apkDigestSha256] : []);

  if (VERIFIER_ALLOWED_DIGEST.length > 0 && digestsToCheck.length > 0) {
    const hasMatchingDigest = digestsToCheck.some(digest =>
      VERIFIER_ALLOWED_DIGEST.includes(digest)
    );

    if (!hasMatchingDigest) {
      console.warn('[verifier] APK digest not in allowed list');
      return false;
    }
  }

  return true;
}

/**
 * Helper function to get a human-readable summary of the integrity verdict
 */
export function getIntegrityVerdict(payload: IntegrityPayload): {
  deviceIntegrity: string;
  appIntegrity: string;
  accountIntegrity: string;
} {
  const deviceVerdict = payload.deviceIntegrity?.deviceRecognitionVerdict || [];
  const appVerdict = payload.appIntegrity?.appRecognitionVerdict || 'UNKNOWN';
  const accountVerdict = payload.accountDetails?.appLicensingVerdict || 'UNKNOWN';

  return {
    deviceIntegrity: deviceVerdict.length > 0 ? deviceVerdict.join(', ') :
                     (payload.basicIntegrity ? 'BASIC_INTEGRITY' : 'NO_INTEGRITY'),
    appIntegrity: appVerdict,
    accountIntegrity: accountVerdict,
  };
}
