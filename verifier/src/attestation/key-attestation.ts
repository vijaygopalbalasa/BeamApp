/**
 * Android Hardware Key Attestation Validator
 *
 * Validates X.509 certificate chains with Android Key Attestation extension.
 * Supports StrongBox, TEE, and software-backed keys.
 *
 * References:
 * - https://source.android.com/docs/security/features/keystore/attestation
 * - https://developer.android.com/privacy-and-security/security-key-attestation
 */

import * as x509 from '@peculiar/x509';
import * as asn1 from 'asn1js';
import { VERIFIER_ALLOW_DEV } from '../env.js';

// Google Root CA certificate fingerprints (SHA-256)
// These are the trusted root certificates for Android Key Attestation
// Source: https://android.googleapis.com/attestation/root
// Last updated: 2025-01-27
const GOOGLE_ROOT_FINGERPRINTS = new Set([
  // Google Hardware Attestation Root 1
  // Subject: serialNumber=f92009e853b6b045
  // Valid: 2022-03-20 to 2042-03-15
  // Algorithm: RSA 4096-bit
  'CEDB1CB6DC896AE5EC797348BCE9286753C2B38EE71CE0FBE34A9A1248800DFC',

  // Google Key Attestation CA1
  // Subject: CN=Key Attestation CA1, OU=Android, O=Google LLC, C=US
  // Valid: 2025-07-17 to 2035-07-15
  // Algorithm: ECDSA P-384
  '6D9DB4CE6C5C0B293166D08986E05774A8776CEB525D9E4329520DE12BA4BCC0',
]);

// Android Key Attestation extension OID
const KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';

export interface KeyAttestationValidationResult {
  valid: boolean;
  reason?: string;
  securityLevel?: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  challenge?: string;
  deviceInfo?: {
    osVersion?: number;
    osPatchLevel?: number;
    vendorPatchLevel?: number;
    bootPatchLevel?: number;
  };
}

/**
 * Validate Android Key Attestation certificate chain
 */
export async function validateKeyAttestationChain(
  certificateChain: string[],
  expectedChallenge: string
): Promise<KeyAttestationValidationResult> {
  console.log('[key-attestation] Validating certificate chain', {
    chainLength: certificateChain.length,
    challengeLength: expectedChallenge.length,
  });

  // ========== Step 1: Basic validation ==========
  if (!certificateChain || certificateChain.length === 0) {
    return { valid: false, reason: 'empty_certificate_chain' };
  }

  if (certificateChain.length < 2) {
    return { valid: false, reason: 'insufficient_chain_length' };
  }

  try {
    // ========== Step 2: Parse certificates ==========
    const certs: x509.X509Certificate[] = [];

    for (let i = 0; i < certificateChain.length; i++) {
      try {
        // Certificates come from Android as base64-encoded DER
        const certBuffer = Buffer.from(certificateChain[i], 'base64');

        // Parse using @peculiar/x509
        const cert = new x509.X509Certificate(certBuffer);
        certs.push(cert);

        console.log(`[key-attestation] Parsed cert ${i}:`, {
          subject: cert.subject,
          issuer: cert.issuer,
          serialNumber: cert.serialNumber,
        });
      } catch (parseError) {
        console.error(`[key-attestation] Failed to parse certificate ${i}:`, parseError);
        return { valid: false, reason: `cert_parse_error_at_index_${i}` };
      }
    }

    // ========== Step 3: Validate certificate expiration ==========
    const now = new Date();
    for (let i = 0; i < certs.length; i++) {
      const cert = certs[i];
      const notBefore = new Date(cert.notBefore);
      const notAfter = new Date(cert.notAfter);

      if (now < notBefore) {
        console.error(`[key-attestation] Certificate ${i} not yet valid`, {
          notBefore: notBefore.toISOString(),
          now: now.toISOString(),
        });
        return { valid: false, reason: `cert_not_yet_valid_at_index_${i}` };
      }

      if (now > notAfter) {
        console.error(`[key-attestation] Certificate ${i} expired`, {
          notAfter: notAfter.toISOString(),
          now: now.toISOString(),
        });
        return { valid: false, reason: `cert_expired_at_index_${i}` };
      }

      console.log(`[key-attestation] ✅ Certificate ${i} validity OK`, {
        notBefore: notBefore.toISOString(),
        notAfter: notAfter.toISOString(),
      });
    }

    // ========== Step 4: Verify certificate chain ==========
    // Each certificate (except root) must be signed by the next certificate
    for (let i = 0; i < certs.length - 1; i++) {
      const cert = certs[i];
      const issuerCert = certs[i + 1];

      try {
        const isValid = await cert.verify({
          publicKey: await issuerCert.publicKey.export(),
        });

        if (!isValid) {
          console.error(`[key-attestation] Certificate ${i} not signed by certificate ${i + 1}`);
          return { valid: false, reason: `chain_verification_failed_at_index_${i}` };
        }

        console.log(`[key-attestation] ✅ Certificate ${i} verified by ${i + 1}`);
      } catch (verifyError) {
        console.error(`[key-attestation] Verification error at index ${i}:`, verifyError);
        return { valid: false, reason: `chain_verification_error_at_index_${i}` };
      }
    }

    // ========== Step 5: Verify root certificate ==========
    const rootCert = certs[certs.length - 1];
    const rootFingerprint = await getCertificateFingerprint(rootCert);

    console.log('[key-attestation] Root certificate fingerprint:', rootFingerprint);

    // In dev mode, allow any root
    if (VERIFIER_ALLOW_DEV) {
      console.warn('[key-attestation] ⚠️ Dev mode - skipping root CA verification');
    } else {
      if (!GOOGLE_ROOT_FINGERPRINTS.has(rootFingerprint.toUpperCase())) {
        console.error('[key-attestation] Untrusted root certificate');
        return { valid: false, reason: 'untrusted_root_certificate' };
      }
      console.log('[key-attestation] ✅ Root certificate trusted');
    }

    // ========== Step 6: Extract attestation extension from leaf certificate ==========
    const leafCert = certs[0];
    const attestationExtension = getAttestationExtension(leafCert);

    if (!attestationExtension) {
      console.error('[key-attestation] No attestation extension found in leaf certificate');
      return { valid: false, reason: 'missing_attestation_extension' };
    }

    console.log('[key-attestation] ✅ Found attestation extension');

    // ========== Step 7: Parse attestation extension ==========
    const attestationData = parseAttestationExtension(attestationExtension);

    if (!attestationData) {
      console.error('[key-attestation] Failed to parse attestation extension');
      return { valid: false, reason: 'attestation_extension_parse_error' };
    }

    console.log('[key-attestation] Parsed attestation data:', {
      securityLevel: attestationData.securityLevel,
      challenge: attestationData.challenge?.substring(0, 32) + '...',
    });

    // ========== Step 8: Verify challenge ==========
    const challengeBuffer = Buffer.from(expectedChallenge, 'base64');
    const attestedChallengeBuffer = attestationData.challenge
      ? Buffer.from(attestationData.challenge, 'base64')
      : null;

    if (!attestedChallengeBuffer || !challengeBuffer.equals(attestedChallengeBuffer)) {
      console.error('[key-attestation] Challenge mismatch', {
        expected: expectedChallenge.substring(0, 32),
        attested: attestationData.challenge?.substring(0, 32),
      });
      return { valid: false, reason: 'challenge_mismatch' };
    }

    console.log('[key-attestation] ✅ Challenge verified');

    // ========== Success ==========
    return {
      valid: true,
      securityLevel: attestationData.securityLevel,
      challenge: attestationData.challenge,
      deviceInfo: attestationData.deviceInfo,
    };
  } catch (error) {
    console.error('[key-attestation] Unexpected error during validation:', error);
    return {
      valid: false,
      reason: `unexpected_error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get certificate fingerprint (SHA-256)
 */
async function getCertificateFingerprint(cert: x509.X509Certificate): Promise<string> {
  const certBuffer = Buffer.from(cert.rawData);
  const hashBuffer = await crypto.subtle.digest('SHA-256', certBuffer);
  return Buffer.from(hashBuffer).toString('hex').toUpperCase();
}

/**
 * Extract attestation extension from certificate
 */
function getAttestationExtension(cert: x509.X509Certificate): ArrayBuffer | null {
  try {
    // Look for Key Attestation extension (OID 1.3.6.1.4.1.11129.2.1.17)
    const ext = cert.getExtension(KEY_ATTESTATION_OID);
    if (ext) {
      return ext.value;
    }
    return null;
  } catch (error) {
    console.error('[key-attestation] Failed to get attestation extension:', error);
    return null;
  }
}

/**
 * Parse attestation extension to extract attestation data
 *
 * KeyDescription ASN.1 structure:
 * KeyDescription ::= SEQUENCE {
 *   attestationVersion (0)       INTEGER,
 *   attestationSecurityLevel (1) ENUMERATED,
 *   keyMintVersion (2)           INTEGER,
 *   keyMintSecurityLevel (3)     ENUMERATED,
 *   attestationChallenge (4)     OCTET_STRING,
 *   uniqueId (5)                 OCTET_STRING,
 *   softwareEnforced (6)         AuthorizationList,
 *   hardwareEnforced (7)         AuthorizationList,
 * }
 *
 * SecurityLevel ::= ENUMERATED { Software(0), TrustedEnvironment(1), StrongBox(2) }
 */
function parseAttestationExtension(extensionValue: ArrayBuffer): {
  securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE';
  challenge?: string;
  deviceInfo?: any;
} | null {
  try {
    // Parse the ASN.1 structure
    const asn1Sequence = asn1.fromBER(extensionValue);

    if (asn1Sequence.offset === -1) {
      console.error('[key-attestation] Failed to parse ASN.1 structure');
      return null;
    }

    // The KeyDescription is a SEQUENCE
    const keyDescription = asn1Sequence.result as asn1.Sequence;

    if (!(keyDescription instanceof asn1.Sequence)) {
      console.error('[key-attestation] Root element is not a SEQUENCE');
      return null;
    }

    // Check if we have enough fields
    if (keyDescription.valueBlock.value.length < 5) {
      console.error('[key-attestation] Insufficient fields in KeyDescription');
      return null;
    }

    // Extract attestationSecurityLevel (index 1)
    const attestationSecurityLevelField = keyDescription.valueBlock.value[1];
    let securityLevel: 'STRONGBOX' | 'TEE' | 'SOFTWARE' = 'SOFTWARE';

    if (attestationSecurityLevelField instanceof asn1.Enumerated) {
      const securityLevelValue = attestationSecurityLevelField.valueBlock.valueDec;

      switch (securityLevelValue) {
        case 0:
          securityLevel = 'SOFTWARE';
          break;
        case 1:
          securityLevel = 'TEE';
          break;
        case 2:
          securityLevel = 'STRONGBOX';
          break;
        default:
          console.warn('[key-attestation] Unknown security level:', securityLevelValue);
      }
    }

    // Extract attestationChallenge (index 4)
    const challengeField = keyDescription.valueBlock.value[4];
    let challenge: string | undefined;

    if (challengeField instanceof asn1.OctetString) {
      const challengeBuffer = Buffer.from(challengeField.valueBlock.valueHexView);
      challenge = challengeBuffer.toString('base64');
    }

    // Extract device info from softwareEnforced (index 6) and hardwareEnforced (index 7)
    const deviceInfo: {
      osVersion?: number;
      osPatchLevel?: number;
      vendorPatchLevel?: number;
      bootPatchLevel?: number;
    } = {};

    // Parse both AuthorizationLists
    for (let listIndex = 6; listIndex <= 7; listIndex++) {
      if (listIndex >= keyDescription.valueBlock.value.length) continue;

      const authListField = keyDescription.valueBlock.value[listIndex];

      if (authListField instanceof asn1.Sequence) {
        // AuthorizationList is a SEQUENCE of context-specific tagged values
        for (const item of authListField.valueBlock.value) {
          // Each item should be a context-specific constructed tag
          if (item.idBlock && item.idBlock.tagClass === 3) { // Context-specific
            const tagNumber = item.idBlock.tagNumber;

            // Extract the INTEGER value inside the tag
            if (item instanceof asn1.Constructed && item.valueBlock.value.length > 0) {
              const innerValue = item.valueBlock.value[0];

              if (innerValue instanceof asn1.Integer) {
                const intValue = innerValue.valueBlock.valueDec;

                switch (tagNumber) {
                  case 705:
                    deviceInfo.osVersion = intValue;
                    break;
                  case 706:
                    deviceInfo.osPatchLevel = intValue;
                    break;
                  case 718:
                    deviceInfo.vendorPatchLevel = intValue;
                    break;
                  case 719:
                    deviceInfo.bootPatchLevel = intValue;
                    break;
                }
              }
            }
          }
        }
      }
    }

    console.log('[key-attestation] Parsed attestation (ASN.1):', {
      securityLevel,
      challengeExtracted: !!challenge,
      deviceInfo,
    });

    return {
      securityLevel,
      challenge,
      deviceInfo,
    };
  } catch (error) {
    console.error('[key-attestation] Failed to parse attestation extension:', error);
    return null;
  }
}
