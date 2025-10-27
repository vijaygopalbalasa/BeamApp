/**
 * Rate Limiting Middleware for Verifier Service
 *
 * Prevents abuse and DOS attacks by limiting the number of requests
 * per IP address or API key within a time window.
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

// Rate limit configuration from environment or defaults
const MAX_REQUESTS_PER_WINDOW = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10); // 1 minute default

/**
 * General rate limiter for all API endpoints
 * Allows 100 requests per minute per IP by default
 */
export const generalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS_PER_WINDOW,
  message: {
    error: 'rate_limit_exceeded',
    message: `Too many requests from this IP, please try again later. Limit: ${MAX_REQUESTS_PER_WINDOW} requests per ${WINDOW_MS / 1000} seconds.`,
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use IP address as key
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  // Skip rate limiting in development mode
  skip: (req) => {
    const devMode = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    if (devMode) {
      console.log('[rateLimit] ⚠️  DEV_MODE enabled - skipping rate limit for', req.ip);
    }
    return devMode;
  },
});

/**
 * Strict rate limiter for sensitive operations
 * - Attestation verification: 20 requests per minute
 * - USDC minting: 10 requests per minute
 * - Fraud reporting: 5 requests per minute
 */
export const strictLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: 20, // Lower limit for sensitive operations
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many sensitive operation requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    const devMode = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    return devMode;
  },
});

/**
 * USDC minting rate limiter
 * Very strict - only 10 mints per minute per IP
 */
export const usdcMintLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many USDC mint requests. Limit: 10 per minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    const devMode = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    return devMode;
  },
});

/**
 * Relay upload rate limiter
 * Moderate - 50 uploads per minute per IP
 */
export const relayUploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: 50,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many bundle uploads. Limit: 50 per minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    const devMode = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    return devMode;
  },
});

/**
 * Fraud reporting rate limiter
 * Very strict - only 5 reports per minute per IP
 */
export const fraudReportLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many fraud reports. Limit: 5 per minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    const devMode = process.env.DEV_MODE === 'true' || process.env.VERIFIER_ALLOW_DEV === 'true';
    return devMode;
  },
});
