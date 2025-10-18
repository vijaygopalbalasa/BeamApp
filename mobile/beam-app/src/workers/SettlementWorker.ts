import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { attestationService } from '../services/AttestationService';
import { settlementService } from '../services/SettlementService';
import { wallet } from '../wallet/WalletManager';

const SYNC_INTERVAL_MS = 60_000;

class SettlementWorker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.interval = setInterval(() => {
      void this.tick();
    }, SYNC_INTERVAL_MS);

    AppState.addEventListener('change', state => {
      if (state === 'active') {
        void this.tick();
      }
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
  }

  private async tick(): Promise<void> {
    try {
      const state = await NetInfo.fetch();
      if (!state.isConnected) {
        return;
      }

      const signer = await wallet.getSigner('Settle offline payments');
      if (!signer) {
        return;
      }

      const attestedBundles = await attestationService.loadBundles();
      if (attestedBundles.length === 0) {
        return;
      }

      settlementService.initializeClient(signer);

      for (const attested of attestedBundles) {
        try {
          const settlement = await settlementService.settleBundleOnchain(attested, signer);
          if (__DEV__) {
            console.log('Auto-settled bundle', settlement.bundleId, settlement.signature);
          }
          await attestationService.removeBundle(settlement.bundleId);
        } catch (err) {
          if (__DEV__) {
            console.error('Failed to auto-settle bundle', attested.bundle.tx_id, err);
          }
        }
      }
    } catch (err) {
      if (__DEV__) {
        console.error('Settlement worker tick failed', err);
      }
    }
  }
}

export const settlementWorker = new SettlementWorker();
