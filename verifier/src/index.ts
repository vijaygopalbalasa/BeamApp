import express from 'express';
import cors from 'cors';
import { validateOrExit } from './env-validation.js';

// Validate environment variables at startup
validateOrExit();

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed origins for CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'http://localhost:3000',
      'http://localhost:8081', // React Native Metro
      'https://beam-verifier.vercel.app',
    ];

// Middleware - CORS with restricted origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      console.warn(`[cors] Blocked request from unauthorized origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: false
}));
app.use(express.json({ limit: '1mb' }));

// Import middleware (lazy load to avoid serverless cold start issues)
let authMiddleware: any;
let rateLimitMiddleware: any;

async function getAuthMiddleware() {
  if (!authMiddleware) {
    authMiddleware = await import('./middleware/auth.js');
  }
  return authMiddleware;
}

async function getRateLimitMiddleware() {
  if (!rateLimitMiddleware) {
    rateLimitMiddleware = await import('./middleware/rateLimit.js');
  }
  return rateLimitMiddleware;
}

// Root endpoint (no imports)
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ status: 'ok', service: 'beam-verifier' });
});

// Health check (minimal imports)
app.get('/health', (_req, res) => {
  try {
    const VERIFIER_ALLOW_DEV = true; // TEMP: Force dev mode until Play Integrity is configured
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ status: 'ok', devMode: VERIFIER_ALLOW_DEV });
  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ status: 'error' });
  }
});

// Attestation verification endpoint (lazy import with auth and rate limiting)
app.post('/verify-attestation', async (req, res, next) => {
  try {
    // Apply rate limiting
    const { strictLimiter } = await getRateLimitMiddleware();
    await new Promise<void>((resolve) => {
      strictLimiter(req, res, () => resolve());
    });

    // Apply authentication
    const { requireApiKey } = await getAuthMiddleware();
    await new Promise<void>((resolve, reject) => {
      requireApiKey(req, res, (err?: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Process attestation verification
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
    if (!res.headersSent) {
      res.status(500).json({ valid: false, reason: 'server_error' });
    }
  }
});

// USDC faucet endpoint (lazy imports with rate limiting)
// Note: No auth required for test faucet, but rate limited to prevent abuse
app.post('/test-usdc/mint', async (req, res) => {
  try {
    // Apply USDC mint rate limiting
    const { usdcMintLimiter } = await getRateLimitMiddleware();
    await new Promise<void>((resolve) => {
      usdcMintLimiter(req, res, () => resolve());
    });

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
    if (!res.headersSent) {
      res.status(500).json({ error: 'mint_failed', message: 'Failed to mint USDC' });
    }
  }
});

// Attestation API Routes (lazy import - only load when route is accessed)
app.use('/api/attestation', async (req, res, next) => {
  try {
    const { default: router } = await import('./routes/attestation.js');
    router(req, res, next);
  } catch (err: any) {
    console.error('[verifier] attestation router error', err);
    res.status(500).json({ error: 'attestation_error', details: err.message });
  }
});

// Bundle Relay Endpoints (lazy imports with rate limiting)
app.post('/relay/upload-bundle', async (req, res) => {
  try {
    // Apply relay upload rate limiting
    const { relayUploadLimiter } = await getRateLimitMiddleware();
    await new Promise<void>((resolve) => {
      relayUploadLimiter(req, res, () => resolve());
    });

    const { uploadBundle } = await import('./relay/index.js');
    await uploadBundle(req, res);
  } catch (err) {
    console.error('[verifier] upload bundle error', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'upload_failed' });
    }
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

if (!process.env.VERCEL && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Beam verifier running on port ${PORT}`);
    console.log(`Bundle relay service: enabled`);
    console.log(`Health endpoint: http://localhost:${PORT}/health`);
    console.log(`Attestation endpoint: http://localhost:${PORT}/api/attestation/request`);
  });
}

// Export the app directly for Vercel serverless
export default app;
