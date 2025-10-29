import express from 'express';
import cors from 'cors';
// Defer heavy imports to handlers to avoid import-time crashes on serverless
import { VERIFIER_ALLOW_DEV, SOLANA_NETWORK } from './env.js';
import { verifyAttestationRequest } from './attestation/index.js';
import { mintDevnetUsdc, MintServiceError } from './usdc/service.js';
import { uploadBundle, getBundlesForPubkey, getRelayStats, clearAllBundles } from './relay/index.js';
import attestationRouter from './routes/attestation.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  try {
    res.json({ status: 'ok', devMode: VERIFIER_ALLOW_DEV });
  } catch (e) {
    res.status(500).json({ status: 'error' });
  }
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'beam-verifier' });
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

app.post('/test-usdc/mint', async (req, res) => {
  const { ownerAddress, amount } = req.body ?? {};

  if (typeof ownerAddress !== 'string') {
    res.status(400).json({ error: 'invalid_request', message: 'ownerAddress must be provided' });
    return;
  }

  let recipient: any;
  try {
    const { PublicKey } = await import('@solana/web3.js');
    recipient = new PublicKey(ownerAddress);
  } catch {
    res.status(400).json({ error: 'invalid_address', message: 'Invalid Solana address' });
    return;
  }

  const mintAmount = typeof amount === 'number' && amount > 0 ? amount : 100;

  try {
    const result = await mintDevnetUsdc({
      recipient,
      amount: mintAmount,
    });

    const explorerUrl = `https://explorer.solana.com/tx/${result.signature}?cluster=${SOLANA_NETWORK}`;

    res.json({
      signature: result.signature,
      amount: result.amount,
      decimals: result.decimals,
      tokenAccount: result.tokenAccount.toBase58(),
      mint: result.mint.toBase58(),
      explorerUrl,
      message: `Minted ${result.amount} USDC to ${result.tokenAccount.toBase58()}`,
    });
  } catch (err) {
    if (err instanceof MintServiceError) {
      res.status(500).json({ error: err.code ?? 'mint_failed', message: err.message });
      return;
    }

    console.error('[verifier] mint error', err);
    res.status(500).json({ error: 'mint_failed', message: 'Failed to mint USDC' });
  }
});

// Attestation API Routes
app.use('/api/attestation', attestationRouter);

// Bundle Relay Endpoints
app.post('/relay/upload-bundle', uploadBundle);
app.get('/relay/bundles/:pubkey', getBundlesForPubkey);
app.get('/relay/stats', getRelayStats);

// Admin endpoint (dev only)
if (VERIFIER_ALLOW_DEV) {
  app.post('/relay/clear', clearAllBundles);
}

// Export the Express app for serverless (Vercel). Do not call listen() on Vercel.
// Vercel sets process.env.VERCEL. In local/dev mode, start the server normally.
const port = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;

if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Beam verifier running on port ${PORT}`);
    console.log(`Bundle relay service: enabled`);
    console.log(`Health endpoint: http://localhost:${PORT}/health`);
    console.log(`Attestation endpoint: http://localhost:${PORT}/api/attestation/request`);
  });
}

// Create a serverless handler for Vercel
const handler = (req: any, res: any) => app(req, res);
export default handler as any;
module.exports = handler;
