import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, ActivityIndicator, TextInput, View, StyleSheet, Modal, Image, Platform } from 'react-native';
import type { BeamQRPaymentRequest, OfflineBundle, AttestationEnvelope } from '@beam/shared';
import EncryptedStorage from 'react-native-encrypted-storage';
import QRCodeGenerator from '../native/QRCodeGenerator';
import bs58 from 'bs58';
import { wallet } from '../wallet/WalletManager';
import { serializeBundle, verifyCompletedBundle } from '@beam/shared';
import { SettlementService } from '../services/SettlementService';
import { Config } from '../config';
import { attestationService } from '../services/AttestationService';
import { meshNetworkService } from '../services/MeshNetworkService';
import type { BLEBundleReceivedEvent, BLEErrorEvent } from '../services/MeshNetworkService';
import { bundleTransactionManager, BundleState } from '../storage/BundleTransactionManager';
import { meshDiagnosticsStore } from '../services/MeshDiagnosticsStore';
import { autoSettlementService } from '../services/AutoSettlementService';
import { networkService } from '../services/NetworkService';
import { balanceService } from '../services/BalanceService';
import { BeamProgramClient } from '../solana/BeamProgram';
import { PublicKey } from '@solana/web3.js';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { PaymentSheet } from '../components/features/PaymentSheet';
import { ReceivedBundleList } from '../components/features/ReceivedBundleList';

import { MeshNetworkStatus } from '../components/MeshNetworkStatus';
import { TransactionSuccessModal } from '../components/TransactionSuccessModal';
import { MeshDiagnosticsModal } from '../components/MeshDiagnosticsModal';
import { BLEConnectionModal } from '../components/BLEConnectionModal';
import type { ReceivedBundleListItem } from '../components/features/ReceivedBundleList';
import { palette, radius, spacing } from '../design/tokens';
import { QRScanner } from '../components/QRScanner';
import { decodeOfflineBundle, encodeOfflineBundle } from '../storage/BundleStorage';
import { Buffer } from 'buffer';

function normalizeSignatureField(value: unknown, depth: number = 0): Uint8Array | undefined {
  if (value == null) {
    return undefined;
  }

  if (depth > 5) {
    console.warn('[MerchantScreen] Signature normalization exceeded max depth');
    return undefined;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (Array.isArray(value)) {
    if (value.every(entry => typeof entry === 'number')) {
      return Uint8Array.from(value as number[]);
    }

    const flattened: number[] = [];
    for (const entry of value) {
      if (typeof entry === 'number') {
        flattened.push(entry);
        continue;
      }
      if (Array.isArray(entry) && entry.every(item => typeof item === 'number')) {
        flattened.push(...(entry as number[]));
        continue;
      }

      const nested = normalizeSignatureField(entry, depth + 1);
      if (nested) {
        flattened.push(...Array.from(nested));
      }
    }

    if (flattened.length > 0) {
      return Uint8Array.from(flattened);
    }
  }

  if (typeof value === 'string') {
    try {
      return Uint8Array.from(Buffer.from(value, 'base64'));
    } catch {
      // Not base64
    }

    try {
      return bs58.decode(value);
    } catch {
      // Not base58
    }

    if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
      try {
        return Uint8Array.from(Buffer.from(value, 'hex'));
      } catch {
        // Ignore
      }
    }

    console.warn('[MerchantScreen] Unsupported signature string format');
    return undefined;
  }

  if (typeof value === 'object') {
    const maybe = value as Record<string, unknown>;

    if (maybe.type === 'Buffer' && 'data' in maybe) {
      const coerced = normalizeSignatureField(maybe.data, depth + 1);
      if (coerced) {
        return coerced;
      }
    }

    if ('data' in maybe) {
      const coerced = normalizeSignatureField(maybe.data, depth + 1);
      if (coerced) {
        return coerced;
      }
    }

    if ('bytes' in maybe) {
      const coerced = normalizeSignatureField(maybe.bytes, depth + 1);
      if (coerced) {
        return coerced;
      }
    }

    if ('value' in maybe) {
      const coerced = normalizeSignatureField(maybe.value, depth + 1);
      if (coerced) {
        return coerced;
      }
    }

    const numericEntries = Object.entries(maybe).filter(([key, val]) => {
      return !Number.isNaN(Number(key)) && typeof val === 'number';
    });

    if (numericEntries.length > 0) {
      const sorted = numericEntries.sort(
        ([a], [b]) => Number(a) - Number(b),
      );
      return Uint8Array.from(sorted.map(([, val]) => val as number));
    }

    console.warn('[MerchantScreen] Unsupported signature object:', JSON.stringify(maybe).slice(0, 200));
    return undefined;
  }

  console.warn('[MerchantScreen] Unsupported signature value type', typeof value);
  return undefined;
}

function coerceNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
const settlementService = new SettlementService();

function EmojiIcon({ symbol }: { symbol: string }) {
  return <Small style={styles.emojiIcon}>{symbol}</Small>;
}

export function MerchantScreen() {
  const [amount, setAmount] = useState('10.00');
  const [confirmSheet, setConfirmSheet] = useState(false);
  const [sheetStage, setSheetStage] = useState<'review' | 'submitting' | 'confirming' | 'done' | 'error'>('review');
  const [sheetProgress, setSheetProgress] = useState(0);
  const confirmRef = useRef<null | (() => Promise<void>)>(null);
  const [, setQRData] = useState<string | null>(null);
  const [qrImageBase64, setQRImageBase64] = useState<string | null>(null);
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [receivedPayments, setReceivedPayments] = useState<ReceivedBundleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [merchantAddress, setMerchantAddress] = useState<string | null>(null);
  const [_bleStatus, setBleStatus] = useState<string>('Idle');
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [showBundleScanner, setShowBundleScanner] = useState(false);
  const [isOnline, setIsOnline] = useState(networkService.getIsOnline());
  const [settlementStatus, setSettlementStatus] = useState<string>('');
  const [merchantEscrowBalance, setMerchantEscrowBalance] = useState(0);
  const [_lastKnownBalance, setLastKnownBalance] = useState(0);
  const [_merchantUsdcBalance, setMerchantUsdcBalance] = useState(0);
  const [lastKnownUsdcBalance, setLastKnownUsdcBalance] = useState(0);
  const bleUnsubscribe = useRef<(() => void) | null>(null);

  // NEW: BLE Connection Modal State
  const [bleConnectionModal, setBleConnectionModal] = useState<{
    visible: boolean;
    status: 'searching' | 'connecting' | 'connected' | 'failed';
    peerName?: string;
  }>({ visible: false, status: 'searching' });

  // NEW: Transaction Success Modal State
  const [txSuccessModal, setTxSuccessModal] = useState<{
    visible: boolean;
    type: 'online' | 'offline' | 'settled';
    amount: number;
    signature?: string;
    bundleId?: string;
  }>({ visible: false, type: 'offline', amount: 0 });
  const [fallbackModal, setFallbackModal] = useState<{
    visible: boolean;
    imageBase64?: string;
    bundleId?: string;
  }>({ visible: false });

  const decodeAttestationFromPayload = useCallback((raw: any): AttestationEnvelope | undefined => {
    if (!raw) {
      return undefined;
    }

    try {
      return {
        bundleId: raw.bundleId,
        timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
        nonce: Buffer.from(raw.nonce, 'base64'),
        attestationReport: Buffer.from(raw.attestationReport, 'base64'),
        signature: Buffer.from(raw.signature, 'base64'),
        certificateChain: Array.isArray(raw.certificateChain)
          ? raw.certificateChain.map((entry: string) => Buffer.from(entry, 'base64'))
          : [],
        deviceInfo: raw.deviceInfo,
      };
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to decode attestation payload', error);
      }
      return undefined;
    }
  }, []);

  const loadReceivedPayments = useCallback(async () => {
    try {
      const [transactions, legacyJson] = await Promise.all([
        bundleTransactionManager.getAllTransactions(),
        EncryptedStorage.getItem(MERCHANT_RECEIVED_KEY),
      ]);

      const items = new Map<string, ReceivedBundleListItem>();

      transactions.forEach(tx => {
        if (!tx || !tx.bundle) {
          return;
        }
        items.set(tx.bundle.tx_id, {
          bundle: tx.bundle,
          state: tx.state,
          updatedAt: tx.timestamp,
          error: tx.error,
        });
      });

      if (legacyJson) {
        try {
          const legacyBundles: OfflineBundle[] = JSON.parse(legacyJson);
          legacyBundles.forEach(bundle => {
            if (!items.has(bundle.tx_id)) {
              items.set(bundle.tx_id, {
                bundle,
                state: BundleState.PENDING,
                updatedAt: bundle.timestamp,
              });
            }
          });
        } catch (parseErr) {
          console.error('[MerchantScreen] Failed to parse legacy merchant receipts:', parseErr);
        }
      }

      const filtered = Array.from(items.values())
        .filter(item =>
          (!merchantAddress || item.bundle.merchant_pubkey === merchantAddress) &&
          item.state !== BundleState.SETTLED &&
          item.state !== BundleState.ROLLBACK
        )
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      setReceivedPayments(filtered);
      meshDiagnosticsStore.writeQueueSnapshot('merchant', filtered);
      return filtered;
    } catch (err) {
      console.error('Failed to load received payments:', err);
      return [];
    }
  }, [merchantAddress]);

  useEffect(() => {
    void (async () => {
      const pubkey = await wallet.loadWallet();
      if (pubkey) {
        setMerchantAddress(pubkey.toBase58());
      }
    })();
    void loadReceivedPayments();
  }, [loadReceivedPayments]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return () => {};
    }

    const unsubscribe = meshNetworkService.onAdvertisingStateChange(event => {
      switch (event.status) {
        case 'started':
          setIsAdvertising(true);
          setBleStatus('Advertising');
          break;
        case 'stopped':
          setIsAdvertising(false);
          setBleStatus('Idle');
          break;
        case 'error':
          setIsAdvertising(false);
          setBleStatus('Error');
          Alert.alert('Bluetooth Error', event.errorMessage ?? 'Advertising failed. Check Bluetooth settings.', [{ text: 'OK' }]);
          break;
      }
    });

    bleUnsubscribe.current?.();
    bleUnsubscribe.current = unsubscribe;

    return () => {
      unsubscribe();
      if (bleUnsubscribe.current === unsubscribe) {
        bleUnsubscribe.current = null;
      }
    };
  }, []);

  // ========== FIX Bug #9: Use centralized BalanceService for caching ==========
  // Initialize merchant escrow balance from blockchain (with offline caching)
  useEffect(() => {
    if (!merchantAddress) {
      return;
    }

    void (async () => {
      try {
        console.log('[MerchantScreen] Fetching merchant balances via BalanceService...');
        const merchantPubkey = new PublicKey(merchantAddress);

        // Use BalanceService for cached balance (works offline + online)
        const snapshot = await balanceService.getBalance(merchantPubkey, isOnline);
        console.log('[MerchantScreen] ✅ BalanceService returned:', snapshot);

        setMerchantEscrowBalance(snapshot.escrowBalance);
        setLastKnownBalance(snapshot.escrowBalance);
        setMerchantUsdcBalance(snapshot.usdcBalance);
        setLastKnownUsdcBalance(snapshot.usdcBalance);

        console.log('[MerchantScreen] ✅ All balances loaded:', {
          Escrow: snapshot.escrowBalance,
          USDC: snapshot.usdcBalance,
          SOL: snapshot.solBalance,
        });
      } catch (err) {
        console.error('[MerchantScreen] Failed to fetch merchant balances:', err);
        // Keep previous balances on error instead of clearing
      }
    })();
  }, [merchantAddress, isOnline]);

  useEffect(() => {
    // Reserved for future diagnostics hooks
  }, []);

  // Setup network status listener
  useEffect(() => {
    const unsubscribe = networkService.addOnlineListener(online => {
      console.log('[MerchantScreen] Network status changed:', online);
      setIsOnline(online);
      if (online) {
        setSettlementStatus('🌐 Online - Auto-settling...');
        void loadReceivedPayments();
      } else {
        setSettlementStatus('📡 Offline - Payments stored locally');
      }
    });
    return unsubscribe;
  }, [loadReceivedPayments]);

  // Setup auto-settlement listener
  useEffect(() => {
    const unsubscribe = autoSettlementService.addSettlementListener(event => {
      console.log('[MerchantScreen] Settlement event:', event);
      switch (event.type) {
        case 'attestation_fetched':
          setSettlementStatus(`🔐 Attestation fetched for ${event.bundleId.slice(0, 8)}...`);
          break;
        case 'settlement_started':
          setSettlementStatus(`⏳ Settling ${event.bundleId.slice(0, 8)}...`);
          break;
        case 'settlement_success':
          setSettlementStatus(`✅ Settled! ${event.message}`);

          // Update lastKnownBalance to current merchantEscrowBalance (optimistic update confirmed)
          setLastKnownBalance(merchantEscrowBalance);
          console.log('[MerchantScreen] Settlement confirmed, balance synced to blockchain');

          // NEW: Show settled transaction modal with signature
          const signature = event.message?.match(/Transaction: (\w+)/)?.[1];
          setTxSuccessModal({
            visible: true,
            type: 'settled',
            amount: 0, // Amount will be shown from bundle data
            signature: signature,
            bundleId: event.bundleId,
          });

          // Reload payments
          void loadReceivedPayments();
          break;
        case 'settlement_error':
          setSettlementStatus(`❌ Settlement failed: ${event.error}`);
          break;
      }
    });
    return unsubscribe;
  }, [loadReceivedPayments, merchantEscrowBalance]);

  // Blockchain polling for merchant notification (online payments)
  useEffect(() => {
    if (!isOnline || !merchantAddress) {
      return;
    }

    console.log('[MerchantScreen] Starting blockchain polling for USDC wallet balance...');

    const pollInterval = setInterval(async () => {
      try {
        const merchantPubkey = new PublicKey(merchantAddress);

        // Get merchant's USDC wallet balance
        const usdcBalanceInfo = await settlementService.getUsdcBalance(merchantPubkey);
        const newUsdcBalance = usdcBalanceInfo.balance;

        // Check if USDC balance increased (payment received)
        if (lastKnownUsdcBalance > 0 && newUsdcBalance > lastKnownUsdcBalance) {
          const difference = newUsdcBalance - lastKnownUsdcBalance;
          console.log('[MerchantScreen] 💰 USDC Balance increased! +', difference, 'USDC');

          // Update balance
          setMerchantUsdcBalance(newUsdcBalance);
          setLastKnownUsdcBalance(newUsdcBalance);

          // Show transaction success modal
          setTxSuccessModal({
            visible: true,
            type: 'online',
            amount: difference,
          });

          // Also show alert
          Alert.alert(
            '💰 Payment Received!',
            `You received ${difference.toFixed(2)} USDC from a customer.\n\nYour new balance is ${newUsdcBalance.toFixed(2)} USDC.`,
            [{ text: 'OK', style: 'default' }]
          );
        } else if (lastKnownUsdcBalance === 0) {
          // First time loading - just set the balance without notification
          setMerchantUsdcBalance(newUsdcBalance);
          setLastKnownUsdcBalance(newUsdcBalance);
          console.log('[MerchantScreen] Initial USDC balance:', newUsdcBalance);
        }
      } catch (err) {
        console.error('[MerchantScreen] Blockchain polling error:', err);
      }
    }, 10000); // Poll every 10 seconds

    return () => {
      console.log('[MerchantScreen] Stopping blockchain polling');
      clearInterval(pollInterval);
    };
  }, [isOnline, merchantAddress, lastKnownUsdcBalance]);

  useEffect(() => {
    return () => {
      console.log('[MerchantScreen] Component unmounting - cleaning up BLE');

      bleUnsubscribe.current?.();
      bleUnsubscribe.current = null;

      // Stop BLE node
      meshNetworkService.stopBLENode()
        .catch((error) => {
          console.error('[MerchantScreen] Error stopping BLE node:', error);
        })
        .finally(() => {
          setIsAdvertising(false);
          setBleStatus('Idle');
        });

      // Cleanup all listeners
      meshNetworkService.cleanup();
    };
  }, []); // Only cleanup on actual component unmount, not on state changes

  // Listen for incoming payment bundles via BLE
  useEffect(() => {
    console.log('[MerchantScreen] Setting up BLE bundle listener');

    const unsubscribeBundles = meshNetworkService.onBundleReceived(async (event: BLEBundleReceivedEvent) => {
      console.log('[MerchantScreen] 📡 BLE Bundle received:', {
        bundleId: event.bundleId,
        bundleSize: event.bundleSize,
        deviceAddress: event.deviceAddress,
        deviceName: event.deviceName,
        timestamp: new Date(event.timestamp).toISOString(),
      });

      if (!merchantAddress) {
        console.warn('[MerchantScreen] Merchant address unavailable; ignoring bundle');
        return;
      }

      try {
        // Parse bundle JSON
        const rawBundle = JSON.parse(event.bundleData) as OfflineBundle & {
          payer_signature?: unknown;
          merchant_signature?: unknown;
        };

        console.log('[MerchantScreen] Raw bundle signature payloads:', {
          payerType: typeof rawBundle.payer_signature,
          merchantType: typeof rawBundle.merchant_signature,
        });

        if (__DEV__) {
          console.log('[MerchantScreen] Raw payer signature sample:',
            JSON.stringify(rawBundle.payer_signature)?.slice(0, 160));
          console.log('[MerchantScreen] Raw merchant signature sample:',
            JSON.stringify(rawBundle.merchant_signature)?.slice(0, 160));
        }

        const bundle: OfflineBundle = {
          tx_id: typeof rawBundle.tx_id === 'string' ? rawBundle.tx_id : String(rawBundle.tx_id ?? ''),
          escrow_pda: typeof rawBundle.escrow_pda === 'string' ? rawBundle.escrow_pda : String(rawBundle.escrow_pda ?? ''),
          token: {
            symbol: typeof rawBundle.token?.symbol === 'string' ? rawBundle.token.symbol : String(rawBundle.token?.symbol ?? 'USDC'),
            mint: typeof rawBundle.token?.mint === 'string' ? rawBundle.token.mint : String(rawBundle.token?.mint ?? ''),
            decimals: coerceNumber(rawBundle.token?.decimals, 0),
            amount: coerceNumber(rawBundle.token?.amount, 0),
          },
          payer_pubkey: typeof rawBundle.payer_pubkey === 'string' ? rawBundle.payer_pubkey : String(rawBundle.payer_pubkey ?? ''),
          merchant_pubkey: typeof rawBundle.merchant_pubkey === 'string' ? rawBundle.merchant_pubkey : String(rawBundle.merchant_pubkey ?? ''),
          nonce: coerceNumber(rawBundle.nonce, 0),
          timestamp: coerceNumber(rawBundle.timestamp, Date.now()),
          version: coerceNumber(rawBundle.version, 1),
          payer_signature: normalizeSignatureField(rawBundle.payer_signature),
          merchant_signature: normalizeSignatureField(rawBundle.merchant_signature),
        };

        if (!bundle.tx_id || !bundle.payer_pubkey || !bundle.merchant_pubkey) {
          throw new Error('Received bundle missing mandatory identifiers');
        }

        if (!bundle.payer_signature || bundle.payer_signature.length !== 64) {
          throw new Error('Invalid payer signature payload received over Bluetooth');
        }

        if (bundle.merchant_signature && bundle.merchant_signature.length !== 64) {
          console.warn('[MerchantScreen] Ignoring merchant signature with unexpected length', bundle.merchant_signature.length);
          bundle.merchant_signature = undefined;
        }

        if (!Number.isFinite(bundle.token.amount) || bundle.token.amount <= 0) {
          throw new Error('Invalid payment amount in bundle payload');
        }

        console.log('[MerchantScreen] Normalized signature lengths:', {
          payerLength: bundle.payer_signature?.length,
          merchantLength: bundle.merchant_signature?.length,
        });

        console.log('[MerchantScreen] Received bundle token field:', JSON.stringify(bundle.token, null, 2));
        console.log('[MerchantScreen] Received bundle full structure:', {
          tx_id: bundle.tx_id,
          token: bundle.token,
          payer_pubkey: bundle.payer_pubkey,
          merchant_pubkey: bundle.merchant_pubkey,
          nonce: bundle.nonce,
          has_payer_sig: !!bundle.payer_signature,
          has_merchant_sig: !!bundle.merchant_signature,
        });

        // Explicitly normalize token object to ensure all properties are enumerable
        // BLE transmission can create objects with non-enumerable properties
        const normalizedToken = bundle.token ? {
          symbol: bundle.token.symbol,
          mint: bundle.token.mint,
          decimals: bundle.token.decimals,
          amount: bundle.token.amount,
        } : null;

        console.log('[MerchantScreen] Normalized token before unsigned:', JSON.stringify(normalizedToken, null, 2));

        const unsigned = {
          tx_id: bundle.tx_id,
          escrow_pda: bundle.escrow_pda,
          token: normalizedToken,
          payer_pubkey: bundle.payer_pubkey,
          merchant_pubkey: bundle.merchant_pubkey,
          nonce: bundle.nonce,
          timestamp: bundle.timestamp,
          version: bundle.version,
        };

        console.log('[MerchantScreen] Unsigned object before serialize:', JSON.stringify(unsigned, null, 2));
        const canonicalBytes = serializeBundle(unsigned);
        console.log('[MerchantScreen] Canonical bundle JSON:', Buffer.from(canonicalBytes).toString('utf8'));
        console.log(
          '[MerchantScreen] Incoming payer signature (hex):',
          bundle.payer_signature ? Buffer.from(bundle.payer_signature).toString('hex') : 'missing'
        );

        // Verify bundle signature
        const payerPubkey = bs58.decode(bundle.payer_pubkey);
        const merchantPubkeyBytes = bs58.decode(merchantAddress);
        const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkeyBytes);

        if (!verification.payerValid) {
          console.error('[MerchantScreen] ❌ Invalid bundle signature');
          Alert.alert(
            'Invalid Payment',
            'Received payment bundle has invalid signature',
            [{ text: 'OK' }]
          );
          return;
        }

        console.log('[MerchantScreen] ✅ Bundle signature verified');

        // Extract payment info
        const amountUSDC = bundle.token?.amount ? bundle.token.amount / 1_000_000 : 0;

        const metadata = {
          amount: bundle.token.amount,
          currency: bundle.token.symbol ?? 'USDC',
          merchantPubkey: bundle.merchant_pubkey,
          payerPubkey: bundle.payer_pubkey,
          nonce: bundle.nonce,
          createdAt: bundle.timestamp,
        };

        console.log('[MerchantScreen] 📝 About to call storeReceivedBundle...');
        console.log('[MerchantScreen] Bundle ID:', bundle.tx_id);
        console.log('[MerchantScreen] Metadata:', metadata);

        await bundleTransactionManager.storeReceivedBundle({
          bundle,
          metadata,
        });

        console.log('[MerchantScreen] ✅ storeReceivedBundle completed successfully');

        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.QUEUED);
        await loadReceivedPayments();

        // Track pending received payment (for visibility, balance updates after settlement)
        if (merchantAddress) {
          await balanceService.addPendingPayment(
            merchantAddress,
            bundle.tx_id,
            amountUSDC,
            'received'
          );
          console.log('[MerchantScreen] ✅ Added pending received payment to balance cache:', amountUSDC, 'USDC');
        }

        Alert.alert(
          '💰 Payment Received!',
          `Received ${amountUSDC.toFixed(2)} USDC from customer via Bluetooth.\n\nDevice: ${event.deviceName}\nYou can settle this payment when back online.`,
          [{ text: 'OK' }]
        );
      } catch (error) {
        console.error('[MerchantScreen] ❌ Failed to process bundle:', error);
        Alert.alert(
          'Error',
          'Failed to process received payment bundle',
          [{ text: 'OK' }]
        );
      }
    });

    // Listen for BLE errors
    const unsubscribeErrors = meshNetworkService.onError((event: BLEErrorEvent) => {
      console.error('[MerchantScreen] 🚨 BLE Error:', event);
      Alert.alert(
        'Bluetooth Error',
        event.errorMessage,
        [{ text: 'OK' }]
      );
    });

    // Cleanup on unmount
    return () => {
      console.log('[MerchantScreen] Cleaning up BLE bundle listener');
      unsubscribeBundles();
      unsubscribeErrors();
    };
  }, [merchantAddress, loadReceivedPayments]);

  const handleCustomerBundleScan = useCallback(
    async (scannedValue: string) => {
      setShowBundleScanner(false);
      setLoading(true);

      try {
        if (!scannedValue || scannedValue.trim().length === 0) {
          throw new Error('Scanned QR payload is empty.');
        }

        let payload: any;
        try {
          payload = JSON.parse(scannedValue);
        } catch (err) {
          throw new Error('Scanned code is not valid Beam bundle data.');
        }

        if (!payload || typeof payload !== 'object' || payload.type !== 'beam_bundle' || !payload.bundle) {
          throw new Error('This QR code is not a Beam payment bundle.');
        }

        const bundle = decodeOfflineBundle(payload.bundle);
        const payerAttestation = decodeAttestationFromPayload(payload.payerAttestation);

        const merchantPubkey = await wallet.loadWallet();
        if (!merchantPubkey) {
          throw new Error('Merchant wallet unavailable.');
        }

        if (bundle.merchant_pubkey !== merchantPubkey.toBase58()) {
          throw new Error('Bundle is not addressed to this merchant.');
        }

        const payerPubkey = bs58.decode(bundle.payer_pubkey);
        const merchantPubkeyBytes = bs58.decode(bundle.merchant_pubkey);
        const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkeyBytes);
        if (!verification.payerValid) {
          throw new Error('Invalid payer signature on bundle.');
        }

        // Explicitly normalize token object to ensure all properties are enumerable
        // BLE transmission can create objects with non-enumerable properties
        const normalizedToken = bundle.token ? {
          symbol: bundle.token.symbol,
          mint: bundle.token.mint,
          decimals: bundle.token.decimals,
          amount: bundle.token.amount,
        } : null;

        const unsigned = {
          tx_id: bundle.tx_id,
          escrow_pda: bundle.escrow_pda,
          token: normalizedToken,
          payer_pubkey: bundle.payer_pubkey,
          merchant_pubkey: bundle.merchant_pubkey,
          nonce: bundle.nonce,
          timestamp: bundle.timestamp,
          version: bundle.version,
        };

        const serialized = serializeBundle(unsigned);
        const merchantSignature = await attestationService.signPayload(serialized, 'Sign payment receipt');

        const signedBundle: OfflineBundle = {
          ...bundle,
          merchant_signature: merchantSignature,
        };

        const metadata = {
          amount: signedBundle.token.amount,
          currency: signedBundle.token.symbol,
          merchantPubkey: signedBundle.merchant_pubkey,
          payerPubkey: signedBundle.payer_pubkey,
          nonce: signedBundle.nonce,
          createdAt: signedBundle.timestamp,
        };

        // Use BundleTransactionManager for atomic receipt storage
        try {
          await bundleTransactionManager.storeReceivedBundle({
            bundle: signedBundle,
            metadata,
            payerAttestation,
          });

          if (__DEV__) {
            console.log(`Merchant receipt stored with transaction state for ${signedBundle.tx_id}`);
          }
        } catch (err) {
          // Bundle storage failed - transaction was rolled back
          const errorMessage = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to store receipt: ${errorMessage}`);
        }

        await bundleTransactionManager.updateBundleState(signedBundle.tx_id, BundleState.QUEUED);
        await loadReceivedPayments();

        Alert.alert(
          'Payment Received!',
          `Amount: $${(signedBundle.token.amount / 1_000_000).toFixed(2)} USDC\nNonce: ${signedBundle.nonce}\n\n✅ Bundle stored locally\n⏳ Will be settled when online\n\nPayer: ${signedBundle.payer_pubkey.slice(0, 8)}...${signedBundle.payer_pubkey.slice(-4)}\nBundle ID: ${signedBundle.tx_id.slice(0, 8)}...`,
          [{ text: 'OK' }]
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Alert.alert('Scan failed', message);
      } finally {
        setLoading(false);
      }
    },
    [decodeAttestationFromPayload, loadReceivedPayments]
  );

  const generatePaymentQR = async () => {
    console.log('[MerchantScreen] ========== generatePaymentQR CALLED ==========');
    let merchantPubkey = wallet.getPublicKey();
    if (!merchantPubkey) {
      console.log('[MerchantScreen] No cached pubkey, loading wallet...');
      merchantPubkey = await wallet.loadWallet();
    }

    if (!merchantPubkey) {
      console.error('[MerchantScreen] ❌ Wallet not loaded');
      Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
      return;
    }

    console.log('[MerchantScreen] Merchant pubkey:', merchantPubkey.toBase58());

    try {
      // Validate amount input
      const amountValue = parseFloat(amount);
      console.log('[MerchantScreen] Amount input:', amount, '→ parsed:', amountValue);

      if (isNaN(amountValue) || amountValue <= 0) {
        console.error('[MerchantScreen] ❌ Invalid amount');
        Alert.alert('Invalid Amount', 'Please enter a valid positive number for the payment amount.');
        return;
      }

      if (amountValue > 1000000) {
        console.error('[MerchantScreen] ❌ Amount too large');
        Alert.alert('Amount Too Large', 'Please enter a reasonable amount (less than 1,000,000 USDC).');
        return;
      }

      const qrPayload: BeamQRPaymentRequest = {
        type: 'pay',
        merchant: merchantPubkey.toBase58(),
        amount: Math.floor(amountValue * 1_000_000),
        currency: 'USDC',
        display_amount: amountValue.toFixed(2),
        timestamp: Date.now(),
      };

      const qrString = JSON.stringify(qrPayload);
      console.log('[MerchantScreen] ✅ QR payload ready, generating with ZXing...');

      // Generate QR code using native ZXing
      try {
        const base64Image = await QRCodeGenerator.generate(qrString, 400);
        console.log('[MerchantScreen] ✅ ZXing QR code generated successfully');
        setQRImageBase64(base64Image);
      } catch (err) {
        console.error('[MerchantScreen] ❌ Failed to generate QR code with ZXing:', err);
        Alert.alert('Error', 'Failed to generate QR code');
        return;
      }

      try {
        if (!merchantAddress) {
          throw new Error('Merchant address not available');
        }

        await meshNetworkService.startBLENode({
          serviceUUID: Config.ble.serviceUUID,
          nodeType: 'merchant',
          publicKey: merchantAddress,
        }, { forceRestart: true });

        await meshNetworkService.updatePaymentRequest({
          merchantPubkey: merchantAddress,
          merchantName: merchantPubkey.toBase58().slice(0, 8),
          amount: Math.floor(amountValue * 1_000_000),
          currency: qrPayload.currency,
          description: qrPayload.display_amount,
          displayAmount: qrPayload.display_amount,
        });

        console.log('[MerchantScreen] ✅ Native BLE GATT server started');
        setIsAdvertising(true);
        setBleStatus('Advertising');
      } catch (e) {
        console.error('[MerchantScreen] ❌ Failed to start BLE node:', e);
        Alert.alert(
          'BLE Error',
          'Failed to start Bluetooth advertising. Please check Bluetooth permissions.',
          [{ text: 'OK' }]
        );
      }
      setSheetStage('review');
      setSheetProgress(0);
      confirmRef.current = async () => {
        setSheetStage('submitting');
        setSheetProgress(0.5);
        setQRData(qrString);
        setSheetStage('done');
        setSheetProgress(1);
        setConfirmSheet(false);
        Alert.alert('QR Ready', 'Show this QR code to your customer.');
      };
      setConfirmSheet(true);
    } catch (err) {
      console.error('[MerchantScreen] ❌ Error generating QR:', err);
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to generate QR:\n${message}`);
    } finally {
      console.log('[MerchantScreen] ========== generatePaymentQR COMPLETED ==========');
    }
  };

const demonstratePaymentReceived = () => {
  Alert.alert(
    'How Beam Payments Work',
      '📱 STEP 1: Generate payment QR (you just did this!)\n\n' +
      '👤 STEP 2: Customer scans your QR code\n' +
      '   • Customer sees payment amount\n' +
      '   • Customer confirms payment\n' +
      '   • Creates signed bundle with hardware attestation\n\n' +
      '📡 STEP 3: Automatic delivery via BLE\n' +
      '   • If Bluetooth is ON: Payment delivers automatically\n' +
      '   • If Bluetooth is OFF: Customer shows bundle QR\n\n' +
      '✅ STEP 4: You receive and sign the payment\n' +
      '   • Auto-received via Bluetooth, OR\n' +
      '   • Scan customer\'s bundle QR manually\n\n' +
      '💰 STEP 5: Settle on-chain when internet available\n\n' +
    'TIP: Enable Bluetooth on BOTH devices for automatic payments!'
  );
};

  const handleShareReceipt = useCallback(
    async (item: ReceivedBundleListItem) => {
      try {
        const payload = {
          type: 'beam_bundle',
          bundle: encodeOfflineBundle(item.bundle),
        };
        const base64 = await QRCodeGenerator.generate(JSON.stringify(payload), 380);
        setFallbackModal({
          visible: true,
          imageBase64: base64,
          bundleId: item.bundle.tx_id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert('Failed to generate fallback QR', message);
      }
    },
    [],
  );

  const handleRemoveReceipt = useCallback(
    (item: ReceivedBundleListItem) => {
      Alert.alert(
        'Remove receipt',
        'Removing this receipt deletes the local copy from this device. Only do this if it is no longer needed.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await bundleTransactionManager.deleteMerchantReceipt(item.bundle.tx_id);
                await loadReceivedPayments();
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Alert.alert('Remove failed', message);
              }
            },
          },
        ],
      );
    },
    [loadReceivedPayments],
  );

  const reportConflict = async (item: ReceivedBundleListItem) => {
    const payment = item.bundle;
    try {
      const signer = await wallet.getSigner('Report conflicting bundle');
      if (!signer) {
        Alert.alert('Error', 'Wallet not loaded');
        return;
      }

      await settlementService.reportFraudEvidence(payment, signer, 'duplicateBundle');
      Alert.alert('Fraud report submitted', 'The verifier will review conflicting evidence for this bundle.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Report failed', message);
    }
  };

  const totalReceived = receivedPayments.reduce((sum, item) => sum + (item.bundle.token?.amount ?? 0) / 1_000_000, 0);
  const queuedCount = receivedPayments.filter(item =>
    item.state === BundleState.PENDING ||
    item.state === BundleState.ATTESTED ||
    item.state === BundleState.QUEUED ||
    item.state === BundleState.BROADCAST
  ).length;
  const failedCount = receivedPayments.filter(item => item.state === BundleState.FAILED).length;



  const meshBadge = (
    <StatusBadge
      status={isOnline ? 'online' : isAdvertising ? 'pending' : 'offline'}
      label={isOnline ? (settlementStatus || 'Online - Auto-settling') : isAdvertising ? 'BLE Active - Offline' : 'Offline'}
      icon={isOnline ? '🌐' : isAdvertising ? '📡' : '📡'}
    />
  );

  const hero = (
    <Hero
      chip={meshBadge}
      title="Merchant"
      subtitle={
        isOnline
          ? 'Online - Accepting payments via Bluetooth. Auto-settling on Solana.'
          : isAdvertising
            ? 'Offline - Accepting payments via Bluetooth. Will auto-settle when online.'
            : 'Generate QR to accept offline payments. Bluetooth activates automatically.'
      }
      right={
        <View style={styles.heroCardsContainer}>
          <Card variant="glass" padding="lg" style={styles.heroCard}>
            <Small style={styles.labelMuted}>Escrow balance</Small>
            <HeadingL>${merchantEscrowBalance.toFixed(2)}</HeadingL>
            <Body style={styles.heroSub}>
              {isOnline ? 'Synced with blockchain' : 'Local balance (offline)'}
            </Body>
          </Card>
          <Card variant="glass" padding="lg" style={styles.heroCard}>
            <Small style={styles.labelMuted}>Total received</Small>
            <HeadingL>${totalReceived.toFixed(2)}</HeadingL>
            <Body style={styles.heroSub}>
              {'Across offline receipts'}
            </Body>
          </Card>
        </View>
      }
    />
  );

  const receiptsSection = (
    <Section
      title="Payment receipts"
      description={isOnline ? 'Payments auto-settle on Solana when online. No manual action required.' : 'Payments stored locally. Will auto-settle when you come online.'}
    >
      <Card style={styles.metricsCard}>
        <View style={styles.metricsRow}>
          <Metric label="Receipts" value={receivedPayments.length.toString()} caption="Awaiting settlement" accent="purple" />
          <Metric label="USDC held" value={`$${totalReceived.toFixed(2)}`} caption="Across receipts" accent="blue" />
          <Metric
            label="Average size"
            value={`$${receivedPayments.length ? (totalReceived / receivedPayments.length).toFixed(2) : '0.00'}`}
            caption="Per receipt"
            accent="green"
          />
        </View>

        <Small style={styles.helperText}>
          {queuedCount > 0
            ? `${queuedCount} receipt${queuedCount === 1 ? '' : 's'} queued for settlement.`
            : 'All receipts are settled or archived.'}
          {failedCount > 0 ? ` ${failedCount} need manual review.` : ''}
        </Small>

        {failedCount > 0 ? (
          <Card variant="highlight" style={styles.alertCard}>
            <HeadingM style={styles.alertTitle}>Action recommended</HeadingM>
            <Body style={styles.alertBody}>
              {failedCount} receipt{failedCount === 1 ? '' : 's'} failed to settle. Open the receipt to retry, share the fallback QR, or remove it after resolution.
            </Body>
          </Card>
        ) : null}

        <ReceivedBundleList items={receivedPayments} />
      </Card>
    </Section>
  );

  const requestSection = (
    <Section
      title="Request a payment"
      description="Generate QR codes for customers to scan. Payments work offline and settle automatically."
    >
      <Card style={styles.requestCard}>
        <View style={styles.amountRow}>
          <View style={styles.amountField}>
            <Small style={styles.labelMuted}>Amount (USDC)</Small>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="10.00"
              placeholderTextColor="rgba(226,232,240,0.4)"
            />
          </View>
          <Button label="Generate QR" onPress={generatePaymentQR} icon={<EmojiIcon symbol="🧾" />} />
        </View>

        {qrImageBase64 ? (
          <Card variant="glass" padding="lg" style={styles.qrCard}>
            <View style={styles.qrContainer}>
              <Image
                source={{ uri: `data:image/png;base64,${qrImageBase64}` }}
                style={styles.qrImage}
                resizeMode="contain"
              />
            </View>
            <Body style={styles.helperText}>Show this to the customer; bundles sync instantly.</Body>
            <View style={styles.qrActions}>
              <Button label="Info" onPress={demonstratePaymentReceived} variant="secondary" icon={<EmojiIcon symbol="🎓" />} />
              <Button
                label="Clear"
                onPress={() => {
                  setQRData(null);
                  setQRImageBase64(null);
                }}
                variant="ghost"
              />
            </View>
          </Card>
        ) : null}

        {merchantAddress ? (
          <Card variant="glass" padding="md">
            <Small style={styles.labelMuted}>Merchant address</Small>
            <Body selectable numberOfLines={1}>
              {`${merchantAddress.slice(0, 16)}…${merchantAddress.slice(-12)}`}
            </Body>
          </Card>
        ) : null}
      </Card>
    </Section>
  );

  const meshSection = (
    <>
      <Card style={styles.meshCard}>
        <View style={styles.meshHeader}>
          <View style={styles.meshHeaderContent}>
            <HeadingM>Automatic payments</HeadingM>
            <Body style={styles.helperText}>
              Bluetooth advertising is active when a QR code is displayed.
            </Body>
          </View>
          <StatusBadge
            status={isAdvertising ? 'online' : 'offline'}
            label={isAdvertising ? 'Advertising' : 'Inactive'}
            icon={isAdvertising ? '📡' : '🛑'}
          />
        </View>
        <Body style={styles.meshHelper}>
          If customers can’t find you, keep this screen open, ensure Bluetooth is enabled, and review diagnostics for recent mesh events.
        </Body>
        <View style={styles.meshActions}>
          <Button
            label="Scan fallback bundle"
            variant="secondary"
            icon={<EmojiIcon symbol="📷" />}
            onPress={() => setShowBundleScanner(true)}
          />
          <Button
            label="Diagnostics"
            variant="ghost"
            icon={<EmojiIcon symbol="🛠️" />}
            onPress={() => setDiagnosticsVisible(true)}
          />
        </View>
      </Card>
    </>
  );

  return (
    <>
      <Screen header={hero} >
        {receiptsSection}
        {requestSection}
        {meshSection}
        <MeshNetworkStatus />
        {settlementStatus ? (
          <Section title="Status" description="Real-time payment processing updates">
            <Card variant="highlight" style={styles.statusCard}>
              <Body style={styles.statusText}>{settlementStatus}</Body>
            </Card>
          </Section>
        ) : null}
      </Screen>

      {loading ? (
        <View style={styles.loadingOverlay}>
          <Card variant="glass" padding="lg" style={styles.loadingCard}>
            <ActivityIndicator size="large" color={palette.accentBlue} />
            <Body style={styles.loadingBody}>Preparing merchant operations…</Body>
          </Card>
        </View>
      ) : null}

      <Modal
        visible={showBundleScanner}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowBundleScanner(false)}
      >
        <QRScanner onScan={handleCustomerBundleScan} onClose={() => setShowBundleScanner(false)} />
      </Modal>

      {/* Confirm payment request sheet */}
      <PaymentSheet
        visible={confirmSheet}
        title="Confirm Request"
        subtitle={merchantAddress ? `Merchant ${merchantAddress.slice(0, 8)}…${merchantAddress.slice(-6)}` : undefined}
        amountLabel={`$${parseFloat(amount || '0').toFixed(2)} USDC`}
        onCancel={() => setConfirmSheet(false)}
        onConfirm={() => confirmRef.current && confirmRef.current()}
        stage={sheetStage}
        progress={sheetProgress}
      />

      {/* NEW: BLE Connection Modal */}
      <BLEConnectionModal
        visible={bleConnectionModal.visible}
        status={bleConnectionModal.status}
        peerName={bleConnectionModal.peerName}
        role="merchant"
        onConfirm={() => setBleConnectionModal({ ...bleConnectionModal, visible: false })}
        onCancel={async () => {
          setBleConnectionModal({ visible: false, status: 'searching' });
          setIsAdvertising(false);
          await meshNetworkService.stopBLENode();
          setBleStatus('Idle');
        }}
      />

      {/* NEW: Transaction Success Modal */}
      <TransactionSuccessModal
        visible={txSuccessModal.visible}
        type={txSuccessModal.type}
        role="merchant"
        amount={txSuccessModal.amount}
        signature={txSuccessModal.signature}
        bundleId={txSuccessModal.bundleId}
        onClose={() => {
          setTxSuccessModal({ ...txSuccessModal, visible: false });
        void loadReceivedPayments(); // Refresh received payments
        }}
      />

      <Modal
        visible={fallbackModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setFallbackModal({ visible: false })}
      >
        <View style={styles.modalOverlay}>
          <Card variant="glass" style={styles.fallbackModalCard}>
            <HeadingM style={styles.modalTitle}>Share receipt QR</HeadingM>
            <Body style={styles.fallbackDescription}>
              Ask the customer or diagnostics device to scan this code if Bluetooth delivery failed.
            </Body>
            {fallbackModal.imageBase64 ? (
              <Image
                source={{ uri: `data:image/png;base64,${fallbackModal.imageBase64}` }}
                style={styles.fallbackImage}
              />
            ) : (
              <ActivityIndicator size="large" color={palette.accentBlue} style={{ marginVertical: spacing.lg }} />
            )}
            {fallbackModal.bundleId ? (
              <Small style={styles.helperText}>
                Bundle {fallbackModal.bundleId.slice(0, 6)}…{fallbackModal.bundleId.slice(-6)}
              </Small>
            ) : null}
            <Button
              label="Close"
              variant="secondary"
              onPress={() => setFallbackModal({ visible: false })}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </View>
      </Modal>

      <MeshDiagnosticsModal
        visible={diagnosticsVisible}
        onClose={() => setDiagnosticsVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  emojiIcon: {
    fontSize: 20,
  },
  heroCardsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  heroCard: {
    gap: spacing.sm,
    flex: 1,
  },
  labelMuted: {
    color: 'rgba(226,232,240,0.72)',
  },
  heroSub: {
    color: 'rgba(148,163,184,0.9)',
  },
  metricsCard: {
    gap: spacing.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  requestCard: {
    gap: spacing.lg,
  },
  amountRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  amountField: {
    flex: 1,
  },
  input: {
    marginTop: spacing.xs,
    backgroundColor: 'rgba(2,6,23,0.6)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.textPrimary,
    fontSize: 18,
  },
  qrCard: {
    gap: spacing.md,
    alignItems: 'center',
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  qrImage: {
    width: 350,
    height: 350,
  },
  qrActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  meshCard: {
    gap: spacing.md,
  },
  meshHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  meshHeaderContent: {
    flex: 1,
    gap: spacing.xs,
  },
  meshHelper: {
    color: 'rgba(148,163,184,0.82)',
  },
  meshActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  helperText: {
    color: 'rgba(148,163,184,0.82)',
  },
  alertCard: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  alertTitle: {
    color: palette.textPrimary,
  },
  alertBody: {
    color: palette.textSecondary,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingCard: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingBody: {
    color: palette.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  statusCard: {
    gap: spacing.md,
  },
  statusText: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
  fallbackModalCard: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  fallbackDescription: {
    color: palette.textSecondary,
    textAlign: 'center',
  },
  fallbackImage: {
    width: 240,
    height: 240,
    marginVertical: spacing.md,
  },
});
