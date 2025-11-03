/**
 * Authentication Middleware for Verifier Service
 *
 * Implements API key authentication to prevent unauthorized access
 * to sensitive endpoints like attestation verification and USDC minting.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// API keys stored as SHA256 hashes in environment variables
// Format: API_KEY_<name>=<sha256_hash>
const API_KEY_PREFIX = 'API_KEY_';

// Master API key for admin operations (optional)
const MASTER_API_KEY_HASH = process.env.MASTER_API_KEY_HASH;

// Development mode bypass (ONLY for local testing)
const DEV_MODE = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';

/**
 * Hash an API key using SHA256
 * Used to compare against stored hashes
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Load API key hashes from environment variables
 * Returns a Set of valid API key hashes
 */
function loadApiKeyHashes(): Set<string> {
  const hashes = new Set<string>();

  // Add master key if configured
  if (MASTER_API_KEY_HASH) {
    hashes.add(MASTER_API_KEY_HASH);
  }

  // Load all API_KEY_* environment variables
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(API_KEY_PREFIX) && value) {
      hashes.add(value);
    }
  }

  return hashes;
}

const VALID_API_KEY_HASHES = loadApiKeyHashes();

/**
 * Verify if a given API key is valid
 */
function verifyApiKey(apiKey: string | undefined): boolean {
  if (!apiKey) {
    return false;
  }

  const hash = hashApiKey(apiKey);
  return VALID_API_KEY_HASHES.has(hash);
}

/**
 * Authentication middleware - checks for valid API key
 *
 * Supported formats:
 *   1. Authorization: Bearer <api_key>
 *   2. x-api-key: <api_key>
 *
 * In development mode (DEV_MODE=true), authentication is bypassed with a warning.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // Development mode bypass (log warning)
  if (DEV_MODE) {
    console.warn('[auth] ⚠️  DEV_MODE enabled - bypassing authentication');
    next();
    return;
  }

  // Check if any API keys are configured
  if (VALID_API_KEY_HASHES.size === 0) {
    console.error('[auth] ❌ No API keys configured - rejecting request');
    res.status(503).json({
      error: 'service_unavailable',
      message: 'Authentication not configured'
    });
    return;
  }

  let apiKey: string | undefined;

  // Try x-api-key header first (preferred for mobile apps)
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    apiKey = xApiKey;
  } else {
    // Fallback to Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Missing authentication. Provide x-api-key header or Authorization: Bearer <api_key>'
      });
      return;
    }

    // Parse Bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <api_key>'
      });
      return;
    }

    apiKey = parts[1];
  }

  // Verify API key
  if (!verifyApiKey(apiKey)) {
    // Log failed attempt (without exposing the key)
    console.warn(`[auth] ❌ Invalid API key attempted from ${req.ip}`);
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid API key'
    });
    return;
  }

  // API key is valid - proceed to next middleware
  console.log(`[auth] ✅ Authenticated request from ${req.ip}`);
  next();
}

/**
 * Optional middleware - checks API key but allows unauthenticated requests
 * Sets req.authenticated flag for conditional logic
 */
export function optionalApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const apiKey = parts[1];
      (req as any).authenticated = verifyApiKey(apiKey);
    }
  }

  next();
}

/**
 * Utility function to generate a new API key
 * Run this to create API keys for environment variables:
 *
 * ```bash
 * node -e "const crypto = require('crypto'); const key = crypto.randomBytes(32).toString('hex'); console.log('API Key:', key); console.log('Hash:', crypto.createHash('sha256').update(key).digest('hex'));"
 * ```
 *
 * Then set in environment:
 * API_KEY_MOBILE_APP=<hash>
 */
export function generateApiKey(): { key: string; hash: string } {
  const key = crypto.randomBytes(32).toString('hex');
  const hash = hashApiKey(key);
  return { key, hash };
}
