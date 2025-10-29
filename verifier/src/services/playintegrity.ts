/**
 * Google Play Integrity API Service
 *
 * Verifies Play Integrity tokens from Android devices using Google's API.
 * Requires Google Cloud project with Play Integrity API enabled.
 */

import { playintegrity_v1 } from '@googleapis/playintegrity';
import { GoogleAuth } from 'google-auth-library';

const PLAY_INTEGRITY_ENABLED = process.env.PLAY_INTEGRITY_API_KEY !== undefined;
const GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.GOOGLE_CLOUD_PROJECT_NUMBER || '';

// Service account authentication
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

export interface PlayIntegrityVerificationResult {
  success: boolean;
  deviceVerdict?: string[];
  appIntegrity?: {
    appRecognitionVerdict: string;
    packageName: string;
    certificateSha256Digest: string[];
    versionCode?: string;
  };
  accountDetails?: {
    appLicensingVerdict: string;
  };
  requestDetails?: {
    requestPackageName: string;
    timestampMillis: string;
    nonce: string;
  };
  error?: string;
  errorDetails?: string;
}

let cachedClient: playintegrity_v1.Playintegrity | null = null;

/**
 * Initialize Google Play Integrity API client
 */
function getPlayIntegrityClient(): playintegrity_v1.Playintegrity {
  if (cachedClient) {
    return cachedClient;
  }

  // Initialize authentication
  let auth: GoogleAuth;

  if (SERVICE_ACCOUNT_JSON) {
    // Use inline service account JSON
    try {
      const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
      auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/playintegrity'],
      });
    } catch (err) {
      throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (SERVICE_ACCOUNT_PATH) {
    // Use service account file path
    auth = new GoogleAuth({
      keyFile: SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/playintegrity'],
    });
  } else {
    // Use default application credentials (for GCP environments)
    auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/playintegrity'],
    });
  }

  cachedClient = new playintegrity_v1.Playintegrity({ auth });
  console.log('[PlayIntegrity] Client initialized');
  return cachedClient;
}

/**
 * Verify a Play Integrity token using Google's API
 *
 * @param integrityToken - The Play Integrity token from the Android device
 * @param requestHash - Optional nonce/hash to verify (prevents replay attacks)
 * @returns Verification result with device and app integrity verdicts
 */
export async function verifyPlayIntegrityToken(
  integrityToken: string,
  requestHash?: string
): Promise<PlayIntegrityVerificationResult> {
  if (!PLAY_INTEGRITY_ENABLED) {
    return {
      success: false,
      error: 'PLAY_INTEGRITY_NOT_CONFIGURED',
      errorDetails: 'Play Integrity API is not configured. Set PLAY_INTEGRITY_API_KEY environment variable.',
    };
  }

  if (!GOOGLE_CLOUD_PROJECT_ID && !GOOGLE_CLOUD_PROJECT_NUMBER) {
    return {
      success: false,
      error: 'GOOGLE_CLOUD_PROJECT_MISSING',
      errorDetails: 'Google Cloud project ID or number not configured',
    };
  }

  try {
    const client = getPlayIntegrityClient();

    // Package name must be the Android app's package (e.g., com.beam.app)
    const packageName = process.env.VERIFIER_EXPECTED_PACKAGE_NAME || 'com.beam.app';
    const projectIdentifier = GOOGLE_CLOUD_PROJECT_NUMBER || GOOGLE_CLOUD_PROJECT_ID;

    console.log(`[PlayIntegrity] Verifying token for package: ${packageName}, project: ${projectIdentifier}`);

    // Call Play Integrity API with the app package name
    const response = await client.v1.decodeIntegrityToken({
      packageName,
      requestBody: {
        integrityToken,
      },
    });

    if (!response.data || !response.data.tokenPayloadExternal) {
      console.error('[PlayIntegrity] No token payload in response');
      return {
        success: false,
        error: 'INVALID_TOKEN_RESPONSE',
        errorDetails: 'No token payload returned from Play Integrity API',
      };
    }

    const payload = response.data.tokenPayloadExternal;

    // Extract device integrity verdict
    const deviceVerdict = payload.deviceIntegrity?.deviceRecognitionVerdict || [];

    // Validate device meets minimum integrity requirements
    const meetsIntegrity =
      deviceVerdict.includes('MEETS_DEVICE_INTEGRITY') ||
      deviceVerdict.includes('MEETS_BASIC_INTEGRITY') ||
      deviceVerdict.includes('MEETS_STRONG_INTEGRITY');

    if (!meetsIntegrity) {
      console.warn('[PlayIntegrity] Device failed integrity check:', deviceVerdict);
      return {
        success: false,
        deviceVerdict,
        error: 'DEVICE_INTEGRITY_FAILED',
        errorDetails: `Device integrity verdict: ${deviceVerdict.join(', ')}`,
      };
    }

    // Validate nonce/request hash if provided
    if (requestHash && payload.requestDetails?.nonce !== requestHash) {
      console.warn('[PlayIntegrity] Nonce mismatch');
      return {
        success: false,
        error: 'NONCE_MISMATCH',
        errorDetails: 'Request nonce does not match provided hash',
      };
    }

    // Check timestamp is recent (within 5 minutes)
    if (payload.requestDetails?.timestampMillis) {
      const tokenTime = parseInt(payload.requestDetails.timestampMillis, 10);
      const now = Date.now();
      const age = now - tokenTime;
      const maxAge = 5 * 60 * 1000; // 5 minutes

      if (age > maxAge || age < 0) {
        console.warn('[PlayIntegrity] Token timestamp out of acceptable range');
        return {
          success: false,
          error: 'TOKEN_EXPIRED',
          errorDetails: `Token age: ${age}ms, max age: ${maxAge}ms`,
        };
      }
    }

    console.log('[PlayIntegrity] ✅ Verification successful');
    console.log(`[PlayIntegrity] Device verdict: ${deviceVerdict.join(', ')}`);
    console.log(`[PlayIntegrity] App verdict: ${payload.appIntegrity?.appRecognitionVerdict || 'N/A'}`);

    return {
      success: true,
      deviceVerdict,
      appIntegrity: payload.appIntegrity ? {
        appRecognitionVerdict: payload.appIntegrity.appRecognitionVerdict || 'UNKNOWN',
        packageName: payload.appIntegrity.packageName || '',
        certificateSha256Digest: payload.appIntegrity.certificateSha256Digest || [],
        versionCode: payload.appIntegrity.versionCode || undefined,
      } : undefined,
      accountDetails: payload.accountDetails ? {
        appLicensingVerdict: payload.accountDetails.appLicensingVerdict || 'UNKNOWN',
      } : undefined,
      requestDetails: payload.requestDetails ? {
        requestPackageName: payload.requestDetails.requestPackageName || '',
        timestampMillis: payload.requestDetails.timestampMillis || '',
        nonce: payload.requestDetails.nonce || '',
      } : undefined,
    };

  } catch (err) {
    console.error('[PlayIntegrity] API error:', err);
    return {
      success: false,
      error: 'API_ERROR',
      errorDetails: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if Play Integrity API is configured and ready
 */
export function isPlayIntegrityConfigured(): boolean {
  return PLAY_INTEGRITY_ENABLED &&
         (!!GOOGLE_CLOUD_PROJECT_ID || !!GOOGLE_CLOUD_PROJECT_NUMBER) &&
         (!!SERVICE_ACCOUNT_JSON || !!SERVICE_ACCOUNT_PATH);
}

/**
 * Get Play Integrity configuration status for health checks
 */
export function getPlayIntegrityStatus(): {
  enabled: boolean;
  configured: boolean;
  projectId: string | null;
  hasServiceAccount: boolean;
} {
  return {
    enabled: PLAY_INTEGRITY_ENABLED,
    configured: isPlayIntegrityConfigured(),
    projectId: GOOGLE_CLOUD_PROJECT_ID || GOOGLE_CLOUD_PROJECT_NUMBER || null,
    hasServiceAccount: !!SERVICE_ACCOUNT_JSON || !!SERVICE_ACCOUNT_PATH,
  };
}
