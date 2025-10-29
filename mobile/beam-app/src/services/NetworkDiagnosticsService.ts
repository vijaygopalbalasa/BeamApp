import { Connection } from '@solana/web3.js';

export class NetworkDiagnosticsService {
  async measureLatency(rpcUrl: string): Promise<number> {
    const start = Date.now();
    try {
      const conn = new Connection(rpcUrl, { commitment: 'processed' });
      await conn.getSlot('processed');
      return Date.now() - start;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
}

export const networkDiagnostics = new NetworkDiagnosticsService();

