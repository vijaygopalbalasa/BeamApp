import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha256';
import { verifyPlayIntegrityJWS, validateIntegrityPayload } from './google.js';
import {
  VERIFIER_ALLOW_DEV,
  VERIFIER_ALLOW_UNSIGNED,
  VERIFIER_PUBLIC_KEY,
  VERIFIER_SIGNING_KEY,
} from '../env.js';
import { signMessage } from '../crypto.js';

interface AttestationEnvelopeInput {
  bundleId: string;
  timestamp: number;
  nonce: string;
  attestationReport: string;
  signature: string;
  certificateChain: string[];
  deviceInfo: Record<string, unknown>;
  attestationType?: 'KEY_ATTESTATION' | 'PLAY_INTEGRITY';
}

interface BundleSummary {
  amount: number;
  nonce: number;
  payer: string;
  merchant: string;
}

export interface AttestationRequestBody {
  bundleId: string;
  bundleSummary: BundleSummary;
  payerAttestation: AttestationEnvelopeInput;
  merchantAttestation?: AttestationEnvelopeInput;
}

export interface VerifierProofPayload {
  root: string;
  nonce: string;
  timestamp: number;
  signature: string;
}

interface VerifyResponse {
  valid: boolean;
  reason?: string;
  proofs?: {
    payer?: VerifierProofPayload;
    merchant?: VerifierProofPayload;
  };
  verifierPublicKey?: string;
}

export async function verifyAttestationRequest(body: AttestationRequestBody): Promise<VerifyResponse> {
  if (!body || typeof body !== 'object') {
    return { valid: false, reason: 'invalid_body' };
  }

  if (!body.bundleId || typeof body.bundleId !== 'string') {
    return { valid: false, reason: 'missing_bundle_id' };
  }

  const summary = validateBundleSummary(body.bundleSummary);
  if (!summary) {
    return { valid: false, reason: 'invalid_bundle_summary' };
  }

  if (!body.payerAttestation) {
    return { valid: false, reason: 'missing_payer_attestation' };
  }

  const payerResult = await verifySingleEnvelope(body.bundleId, body.payerAttestation);
  if (!payerResult.valid) {
    return payerResult;
  }

  let merchantProof: VerifierProofPayload | undefined;

  if (body.merchantAttestation) {
    const merchantResult = await verifySingleEnvelope(body.bundleId, body.merchantAttestation);
    if (!merchantResult.valid) {
      return merchantResult;
    }
    merchantProof = await buildProof(body.bundleId, summary, body.merchantAttestation, 'merchant');
  }

  const payerProof = await buildProof(body.bundleId, summary, body.payerAttestation, 'payer');

  return {
    valid: true,
    proofs: {
      payer: payerProof,
      merchant: merchantProof,
    },
    verifierPublicKey: Buffer.from(VERIFIER_PUBLIC_KEY).toString('base64'),
  };
}

async function verifySingleEnvelope(bundleId: string, envelope: AttestationEnvelopeInput): Promise<{ valid: boolean; reason?: string }> {
  if (!envelope.bundleId || envelope.bundleId !== bundleId) {
    return { valid: false, reason: 'bundle_mismatch' };
  }

  if (!envelope.attestationReport) {
    return VERIFIER_ALLOW_UNSIGNED
      ? { valid: true }
      : { valid: false, reason: 'missing_report' };
  }

  const attestationType = envelope.attestationType || 'PLAY_INTEGRITY';

  if (attestationType === 'PLAY_INTEGRITY') {
    return await verifyPlayIntegrityAttestation(envelope);
  } else if (attestationType === 'KEY_ATTESTATION') {
    return await verifyKeyAttestation(envelope);
  } else {
    return { valid: false, reason: 'unknown_attestation_type' };
  }
}

async function verifyPlayIntegrityAttestation(envelope: AttestationEnvelopeInput): Promise<{ valid: boolean; reason?: string }> {
  const jws = Buffer.from(envelope.attestationReport, 'base64').toString('utf8');
  const payload = await verifyPlayIntegrityJWS(jws);

  if (!payload) {
    return VERIFIER_ALLOW_DEV
      ? { valid: true, reason: 'dev_mode' }
      : { valid: false, reason: 'verification_failed' };
  }

  const nonce = Buffer.from(envelope.nonce, 'base64').toString('utf8');
  const isValid = validateIntegrityPayload(payload, nonce);

  if (!isValid) {
    return { valid: false, reason: 'payload_invalid' };
  }

  return { valid: true };
}

async function verifyKeyAttestation(envelope: AttestationEnvelopeInput): Promise<{ valid: boolean; reason?: string }> {
  // Key Attestation verification
  // This is the legacy Android Key Attestation using certificate chains

  if (!envelope.certificateChain || envelope.certificateChain.length === 0) {
    return VERIFIER_ALLOW_DEV
      ? { valid: true, reason: 'dev_mode_no_cert_chain' }
      : { valid: false, reason: 'missing_cert_chain' };
  }

  // For now, basic validation
  // In production, you should:
  // 1. Parse the X.509 certificate chain
  // 2. Verify chain validity and root trust
  // 3. Extract and verify attestation extension
  // 4. Validate challenge/nonce
  // 5. Check hardware-backed key properties

  if (VERIFIER_ALLOW_DEV) {
    console.warn('[verifier] Key attestation verification not fully implemented, allowing in dev mode');
    return { valid: true, reason: 'dev_mode_key_attestation' };
  }

  // Minimal validation: check that certificate chain exists and is properly formatted
  try {
    const certCount = envelope.certificateChain.length;
    if (certCount < 2) {
      return { valid: false, reason: 'insufficient_cert_chain' };
    }

    // TODO: Implement proper certificate chain validation
    // For now, accept if certificate chain is present
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'cert_chain_parse_error' };
  }
}

function validateBundleSummary(value: any): (BundleSummary & { amount: number; nonce: number }) | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const amount = Number((value as BundleSummary).amount);
  const nonce = Number((value as BundleSummary).nonce);
  const payer = typeof value.payer === 'string' ? value.payer : '';
  const merchant = typeof value.merchant === 'string' ? value.merchant : '';

  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(nonce) || nonce < 0) {
    return null;
  }

  if (!payer || !merchant) {
    return null;
  }

  return { amount, nonce, payer, merchant };
}

async function buildProof(
  bundleId: string,
  summary: BundleSummary,
  envelope: AttestationEnvelopeInput,
  role: AttestationRole,
): Promise<VerifierProofPayload> {
  const nonceBytes = Buffer.from(envelope.nonce, 'base64');
  if (nonceBytes.length !== 32) {
    throw new Error('invalid_attestation_nonce');
  }

  const payer = bs58.decode(summary.payer);
  const merchant = bs58.decode(summary.merchant);

  const root = computeAttestationRoot({
    role,
    bundleId,
    payer,
    merchant,
    amount: BigInt(Math.trunc(summary.amount)),
    bundleNonce: BigInt(Math.trunc(summary.nonce)),
    attestationNonce: nonceBytes,
    attestationTimestamp: BigInt(Math.trunc(envelope.timestamp)),
  });

  const signature = await signMessage(VERIFIER_SIGNING_KEY, root);

  return {
    root: Buffer.from(root).toString('base64'),
    nonce: envelope.nonce,
    timestamp: envelope.timestamp,
    signature: Buffer.from(signature).toString('base64'),
  };
}
type AttestationRole = 'payer' | 'merchant';

interface AttestationRootInput {
  role: AttestationRole;
  bundleId: string;
  payer: Uint8Array;
  merchant: Uint8Array;
  amount: bigint | number;
  bundleNonce: bigint | number;
  attestationNonce: Uint8Array;
  attestationTimestamp: bigint | number;
}

const PREFIX = new TextEncoder().encode('beam.attestation.v1');

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function toLittleEndianBytes(value: bigint | number, byteLength: number): Uint8Array {
  const bigIntValue = BigInt(value);
  const result = new Uint8Array(byteLength);
  let temp = bigIntValue;
  for (let i = 0; i < byteLength; i++) {
    result[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return result;
}

function computeAttestationRoot(input: AttestationRootInput): Uint8Array {
  if (input.attestationNonce.length !== 32) {
    throw new Error('Attestation nonce must be 32 bytes');
  }

  if (input.payer.length !== 32 || input.merchant.length !== 32) {
    throw new Error('Payer and merchant keys must be 32 bytes');
  }

  const roleByte = new Uint8Array([input.role === 'merchant' ? 1 : 0]);
  const bundleIdBytes = new TextEncoder().encode(input.bundleId);
  const amountBytes = toLittleEndianBytes(input.amount, 8);
  const bundleNonceBytes = toLittleEndianBytes(input.bundleNonce, 8);
  const timestampBytes = toLittleEndianBytes(input.attestationTimestamp, 8);

  const preimage = concatBytes(
    PREFIX,
    bundleIdBytes,
    input.payer,
    input.merchant,
    amountBytes,
    bundleNonceBytes,
    roleByte,
    input.attestationNonce,
    timestampBytes,
  );

  return sha256(preimage);
}
