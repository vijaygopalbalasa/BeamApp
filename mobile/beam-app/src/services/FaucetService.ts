import { Config } from '../config';

interface FaucetResult {
  signature?: string;
  amount?: number;
  message?: string;
}

class FaucetService {
  private readonly fallbackEndpoints = [
    Config.services.usdcFaucet,
    'https://token-faucet.solana.com/api/claim',
    'https://spl-token-faucet.com/api/claim',
  ];

  async requestUsdc(ownerAddress: string): Promise<FaucetResult> {
    const payload = {
      address: ownerAddress,
      owner: ownerAddress,
      wallet: ownerAddress,
      mint: Config.tokens.usdc.mint,
      tokenMint: Config.tokens.usdc.mint,
      token: Config.tokens.usdc.symbol,
    };

    let lastError: Error | undefined;
    for (const endpoint of this.uniqueEndpoints()) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Faucet responded with ${response.status}`);
        }

        const text = await response.text();
        const data = this.safeParse(text);
        if (data && (data.success === true || data.status === 'ok' || data.signature || data.txid)) {
          return {
            signature: data.signature || data.txid || data.transaction,
            amount: data.amount || data.uiAmount || data.quantity,
            message: data.message || data.detail,
          };
        }

        if (data && data.error) {
          throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }

        throw new Error('Unexpected faucet response');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }

    throw lastError ?? new Error('Unable to reach USDC faucet');
  }

  private *uniqueEndpoints(): Iterable<string> {
    const seen = new Set<string>();
    for (const endpoint of this.fallbackEndpoints) {
      if (!endpoint) {
        continue;
      }
      const normalized = endpoint.trim();
      if (normalized.length === 0 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      yield normalized;
    }
  }

  private safeParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch (err) {
      return { raw: text };
    }
  }
}

export const faucetService = new FaucetService();
