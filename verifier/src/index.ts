import express from 'express';
import { VERIFIER_ALLOW_DEV } from './env';
import { verifyAttestationRequest } from './attestation';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', devMode: VERIFIER_ALLOW_DEV });
});

app.post('/verify-attestation', async (req, res) => {
  try {
    const result = await verifyAttestationRequest(req.body);
    if (!result.valid) {
      res.status(400).json({ valid: false, reason: result.reason });
      return;
    }
    res.json({
      valid: true,
      proofs: result.proofs,
      verifierPublicKey: result.verifierPublicKey,
    });
  } catch (err) {
    console.error('[verifier] unexpected error', err);
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

app.listen(PORT, () => {
  console.log(`Beam verifier running on port ${PORT}`);
});
