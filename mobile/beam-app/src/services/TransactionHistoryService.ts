import { wallet } from '../wallet/WalletManager';
import { attestationService, type AttestedBundle } from './AttestationService';

export type TxDirection = 'in' | 'out';
export type TxStatus = 'stored' | 'attested';

export interface TransactionItem {
  id: string;
  direction: TxDirection;
  amount: number; // USDC amount in whole units
  counterparty: string; // base58 pubkey (shortened in UI)
  timestamp: number; // ms
  status: TxStatus;
}


export class TransactionHistoryService {
  async loadAll(): Promise<TransactionItem[]> {
    const pk = wallet.getPublicKey() || (await wallet.loadWallet());
    const my = pk?.toBase58();
    const bundles: AttestedBundle[] = await attestationService.loadBundles();
    const items: TransactionItem[] = bundles.map(b => {
      const isOut = my && b.bundle.payer_pubkey === my;
      const direction: TxDirection = isOut ? 'out' : 'in';
      const counterparty = isOut ? b.bundle.merchant_pubkey : b.bundle.payer_pubkey;
      const status: TxStatus = b.payerAttestation || b.merchantAttestation ? 'attested' : 'stored';
      return {
        id: b.bundle.tx_id,
        direction,
        amount: b.bundle.token.amount / 1_000_000,
        counterparty,
        timestamp: b.bundle.timestamp || Date.now(),
        status,
      };
    });
    // Newest first
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }

  async loadRecent(limit = 5): Promise<TransactionItem[]> {
    const all = await this.loadAll();
    return all.slice(0, limit);
  }
}

export const transactionHistory = new TransactionHistoryService();

