import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS with proper headers
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json({ limit: '1mb' }));

// Root endpoint (no imports)
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ status: 'ok', service: 'beam-verifier' });
});

// Health check (minimal imports)
app.get('/health', (_req, res) => {
  try {
    const VERIFIER_ALLOW_DEV = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ status: 'ok', devMode: VERIFIER_ALLOW_DEV });
  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ status: 'error' });
  }
});

// Attestation verification endpoint (lazy import)
app.post('/verify-attestation', async (req, res) => {
  try {
    const { verifyAttestationRequest } = await import('./attestation/index.js');
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

// USDC faucet endpoint (lazy imports)
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
    const { mintDevnetUsdc, MintServiceError } = await import('./usdc/service.js');
    const result = await mintDevnetUsdc({
      recipient,
      amount: mintAmount,
    });

    const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
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
  } catch (err: any) {
    if (err.name === 'MintServiceError' || err.code) {
      res.status(500).json({ error: err.code ?? 'mint_failed', message: err.message });
      return;
    }

    console.error('[verifier] mint error', err);
    res.status(500).json({ error: 'mint_failed', message: 'Failed to mint USDC' });
  }
});

// Attestation API Routes (lazy import with promise-based router)
const attestationRouterPromise = import('./routes/attestation.js');
app.use('/api/attestation', (req, res, next) => {
  attestationRouterPromise
    .then(module => module.default(req, res, next))
    .catch(err => {
      console.error('[verifier] attestation router error', err);
      res.status(500).json({ error: 'attestation_error', details: err.message });
    });
});

// Bundle Relay Endpoints (lazy imports)
app.post('/relay/upload-bundle', async (req, res) => {
  try {
    const { uploadBundle } = await import('./relay/index.js');
    await uploadBundle(req, res);
  } catch (err) {
    console.error('[verifier] upload bundle error', err);
    res.status(500).json({ error: 'upload_failed' });
  }
});

app.get('/relay/bundles/:pubkey', async (req, res) => {
  try {
    const { getBundlesForPubkey } = await import('./relay/index.js');
    await getBundlesForPubkey(req, res);
  } catch (err) {
    console.error('[verifier] get bundles error', err);
    res.status(500).json({ error: 'fetch_failed' });
  }
});

app.get('/relay/stats', async (req, res) => {
  try {
    const { getRelayStats } = await import('./relay/index.js');
    await getRelayStats(req, res);
  } catch (err) {
    console.error('[verifier] relay stats error', err);
    res.status(500).json({ error: 'stats_failed' });
  }
});

// Admin endpoint (dev only)
const VERIFIER_ALLOW_DEV = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
if (VERIFIER_ALLOW_DEV) {
  app.post('/relay/clear', async (req, res) => {
    try {
      const { clearAllBundles } = await import('./relay/index.js');
      await clearAllBundles(req, res);
    } catch (err) {
      console.error('[verifier] clear bundles error', err);
      res.status(500).json({ error: 'clear_failed' });
    }
  });
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
