import { Router, Request, Response } from 'express';
import { attestationService } from '../services/attestation.js';

const router = Router();

/**
 * POST /api/attestation/request
 * Request attestation for a bundle
 */
router.post('/request', async (req: Request, res: Response) => {
  try {
    const { bundleId, deviceToken, bundleHash, timestamp, deviceInfo } = req.body;

    // Validate request
    if (!bundleId || !deviceToken || !bundleHash || !timestamp || !deviceInfo) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['bundleId', 'deviceToken', 'bundleHash', 'timestamp', 'deviceInfo'],
      });
    }

    console.log(`[API] Attestation request for bundle ${bundleId}`);

    // Validate and issue attestation
    const envelope = await attestationService.validateAndAttest({
      bundleId,
      deviceToken,
      bundleHash,
      timestamp,
      deviceInfo,
    });

    // Encode buffers as base64 for JSON response
    const response = {
      bundleId: envelope.bundleId,
      timestamp: envelope.timestamp,
      nonce: envelope.nonce.toString('base64'),
      attestationReport: envelope.attestationReport.toString('base64'),
      signature: envelope.signature.toString('base64'),
      certificateChain: envelope.certificateChain.map(cert => cert.toString('base64')),
      deviceInfo: envelope.deviceInfo,
    };

    res.json(response);
  } catch (err) {
    console.error('[API] Attestation request failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Attestation failed',
    });
  }
});

/**
 * POST /api/attestation/verify
 * Verify an attestation envelope signature
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { bundleId, attestationReport, signature } = req.body;

    if (!bundleId || !attestationReport || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['bundleId', 'attestationReport', 'signature'],
      });
    }

    const envelope = {
      bundleId,
      timestamp: Date.now(),
      nonce: Buffer.alloc(0),
      attestationReport: Buffer.from(attestationReport, 'base64'),
      signature: Buffer.from(signature, 'base64'),
      certificateChain: [],
      deviceInfo: { model: '', osVersion: '', securityLevel: 'SOFTWARE' as const },
    };

    const valid = await attestationService.verifyAttestationSignature(envelope);

    res.json({
      valid,
      bundleId,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[API] Attestation verification failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Verification failed',
    });
  }
});

/**
 * POST /api/attestation/report-fraud
 * Report fraudulent bundle
 */
router.post('/report-fraud', async (req: Request, res: Response) => {
  try {
    const { deviceToken, bundleId, reason } = req.body;

    if (!deviceToken || !bundleId || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['deviceToken', 'bundleId', 'reason'],
      });
    }

    // Extract device ID and report fraud
    const deviceId = require('crypto').createHash('sha256').update(deviceToken).digest('hex');
    attestationService.reportFraud(deviceId, bundleId, reason);

    res.json({
      success: true,
      message: 'Fraud reported successfully',
    });
  } catch (err) {
    console.error('[API] Fraud report failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Fraud report failed',
    });
  }
});

/**
 * GET /api/attestation/reputation/:deviceId
 * Get device reputation
 */
router.get('/reputation/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    const reputation = attestationService.getReputation(deviceId);

    res.json(reputation);
  } catch (err) {
    console.error('[API] Reputation check failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Reputation check failed',
    });
  }
});

/**
 * GET /api/attestation/blacklist
 * Get all blacklisted devices
 */
router.get('/blacklist', async (req: Request, res: Response) => {
  try {
    const blacklisted = attestationService.getBlacklistedDevices();

    res.json({
      count: blacklisted.length,
      devices: blacklisted,
    });
  } catch (err) {
    console.error('[API] Blacklist fetch failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Blacklist fetch failed',
    });
  }
});

export default router;
