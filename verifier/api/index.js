// api/index.js - Vercel serverless function wrapper
import app from '../dist/index.js';

// Set VERCEL env var before any requests
process.env.VERCEL = '1';

// Export the Express app as the serverless handler
// Vercel will call this function for each request
export default app;
