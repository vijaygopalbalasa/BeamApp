import EncryptedStorage from 'react-native-encrypted-storage';
import type { OfflineBundle } from '@beam/shared';

const BUNDLES_KEY = '@beam:pending_bundles';
const NONCE_KEY = '@beam:current_nonce';

export type PersistedOfflineBundle = Omit<OfflineBundle, 'payer_signature' | 'merchant_signature'> & {
  payer_signature?: number[];
  merchant_signature?: number[];
};

function encodeBundle(bundle: OfflineBundle): PersistedOfflineBundle {
  return {
    ...bundle,
    payer_signature: bundle.payer_signature ? Array.from(bundle.payer_signature) : undefined,
    merchant_signature: bundle.merchant_signature
      ? Array.from(bundle.merchant_signature)
      : undefined,
  };
}

function decodeBundle(bundle: PersistedOfflineBundle): OfflineBundle {
  return {
    ...bundle,
    payer_signature: bundle.payer_signature ? Uint8Array.from(bundle.payer_signature) : undefined,
    merchant_signature: bundle.merchant_signature
      ? Uint8Array.from(bundle.merchant_signature)
      : undefined,
  };
}

export class BundleStorage {
  /**
   * Save pending bundles to storage
   */
  async saveBundles(bundles: OfflineBundle[]): Promise<void> {
    const serializable = bundles.map(encodeBundle);
    const json = JSON.stringify(serializable);
    await EncryptedStorage.setItem(BUNDLES_KEY, json);
  }

  /**
   * Load pending bundles from storage
   */
  async loadBundles(): Promise<OfflineBundle[]> {
    const json = await EncryptedStorage.getItem(BUNDLES_KEY);
    if (!json) {
      return [];
    }

    try {
      const parsed: PersistedOfflineBundle[] = JSON.parse(json);
      return parsed.map(decodeBundle);
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to parse stored bundles:', err);
      }
      await EncryptedStorage.removeItem(BUNDLES_KEY);
      return [];
    }
  }

  /**
   * Add a single bundle
   */
  async addBundle(bundle: OfflineBundle): Promise<void> {
    const bundles = await this.loadBundles();
    bundles.push(bundle);
    await this.saveBundles(bundles);
  }

  /**
   * Remove bundle by tx_id
   */
  async removeBundle(txId: string): Promise<void> {
    const bundles = await this.loadBundles();
    const filtered = bundles.filter(b => b.tx_id !== txId);
    await this.saveBundles(filtered);
  }

  /**
   * Clear all bundles
   */
  async clearBundles(): Promise<void> {
    await EncryptedStorage.removeItem(BUNDLES_KEY);
  }

  /**
   * Update an existing bundle by transaction id. Returning null removes the bundle.
   */
  async updateBundle(
    txId: string,
    mutate: (bundle: OfflineBundle) => OfflineBundle | null
  ): Promise<OfflineBundle | null> {
    const bundles = await this.loadBundles();
    let updated: OfflineBundle | null = null;
    let mutated = false;

    const nextBundles: OfflineBundle[] = [];
    for (const bundle of bundles) {
      if (bundle.tx_id === txId) {
        const result = mutate(bundle);
        mutated = true;
        if (result) {
          nextBundles.push(result);
          updated = result;
        }
      } else {
        nextBundles.push(bundle);
      }
    }

    if (mutated) {
      await this.saveBundles(nextBundles);
    }

    return updated;
  }

  /**
   * Save current nonce
   */
  async saveNonce(nonce: number): Promise<void> {
    await EncryptedStorage.setItem(NONCE_KEY, nonce.toString());
  }

  /**
   * Load current nonce
   */
  async loadNonce(): Promise<number> {
    const nonce = await EncryptedStorage.getItem(NONCE_KEY);
    return nonce ? parseInt(nonce, 10) : 0;
  }

  /**
   * Increment and save nonce
   */
  async incrementNonce(): Promise<number> {
    const current = await this.loadNonce();
    const next = current + 1;
    await this.saveNonce(next);
    return next;
  }
}

export const bundleStorage = new BundleStorage();

export const encodeOfflineBundle = encodeBundle;
export const decodeOfflineBundle = decodeBundle;
