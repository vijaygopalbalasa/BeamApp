import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, Modal, RefreshControl, TextInput, Platform, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wallet } from '../wallet/WalletManager';
import { createUnsignedBundle, serializeBundle } from '@beam/shared';
import type { OfflineBundle } from '@beam/shared';
import { sha256 } from '@noble/hashes/sha256';
import { SettlementService } from '../services/SettlementService';
import { balanceService } from '../services/BalanceService';
import { bundleStorage } from '../storage/BundleStorage';
import { bundleTransactionManager, BundleState } from '../storage/BundleTransactionManager';
import { PublicKey } from '@solana/web3.js';
import { QRScanner } from '../components/QRScanner';
import { Config } from '../config';
import { BeamProgramClient } from '../solana/BeamProgram';
import { attestationService } from '../services/AttestationService';
import { meshNetworkService, type MeshNetworkConfig } from '../services/MeshNetworkService';
import { autoSettlementService } from '../services/AutoSettlementService';
import { meshDiagnosticsStore } from '../services/MeshDiagnosticsStore';
import { networkService } from '../services/NetworkService';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { MeshNetworkStatus } from '../components/MeshNetworkStatus';
import { SecurityStatusCard } from '../components/SecurityStatusCard';
import { TransactionHistory } from '../components/TransactionHistory';
import { PaymentFlowAnimation, type PaymentStage } from '../components/PaymentFlowAnimation';
import { PaymentFlowWizard, type PaymentWizardStep } from '../components/features/PaymentFlowWizard';
import { TransactionSuccessModal } from '../components/TransactionSuccessModal';
import { MeshDiagnosticsModal } from '../components/MeshDiagnosticsModal';
import { PendingBundleList, type PendingBundleListItem } from '../components/features/PendingBundleList';
import { palette, radius, spacing } from '../design/tokens';
import type { BundleHistoryEntry, FraudRecordEntry } from '../solana/types';
import { Buffer } from 'buffer';
import NetInfo from '@react-native-community/netinfo';
import QRCodeGenerator from '../native/QRCodeGenerator';
import { encodeOfflineBundle } from '../storage/BundleStorage';

function TextIcon({ label }: { label: string }) {
  return <Small style={styles.textIcon}>{label}</Small>;
}

const settlementService = new SettlementService();

type PaymentContext = {
  merchantPubkey: string;
  merchantName?: string;
  amountInUsdc: number;
  amountInSmallestUnit: number;
  amountLabel: string;
  description: string;
  rawRequest?: string;
};

type OfflineRequestContext = PaymentContext & {
  bundle?: OfflineBundle;
};

type FallbackModalState = {
  visible: boolean;
  imageBase64?: string;
  bundleId?: string;
};

const OFFLINE_FAILURE_TIPS = [
  'Ensure the merchant keeps the QR screen open with Bluetooth advertising active.',
  'Leave both phones unlocked within two meters to maintain the BLE link.',
  'Confirm Bluetooth and Location permissions stay enabled on both devices.',
];

function buildOfflineFailureMessage(base: string): string {
  const trimmed = base.trim();
  const alreadyAnnotated = trimmed.includes('Ensure the merchant keeps the QR screen open');
  if (alreadyAnnotated) {
    return trimmed;
  }
  const headline = trimmed.length > 0 ? trimmed : 'Failed to deliver bundle via Bluetooth.';
  const tips = OFFLINE_FAILURE_TIPS.map(tip => `• ${tip}`).join('\n');
  return `${headline}\n\n${tips}`;
}

export function CustomerScreen() {
  const [escrowBalance, setEscrowBalance] = useState(0);
  const [walletSolBalance, setWalletSolBalance] = useState(0);
  const [walletUsdcBalance, setWalletUsdcBalance] = useState(0);
  const [pendingBundles, setPendingBundles] = useState<PendingBundleListItem[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [history, setHistory] = useState<BundleHistoryEntry[]>([]);
  const [fraudRecords, setFraudRecords] = useState<FraudRecordEntry[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [meshStatus, setMeshStatus] = useState<'idle' | 'scanning' | 'connecting' | 'connected' | 'error'>('idle');
  const connectedPeersRef = useRef<Set<string>>(new Set());
  const [connectedPeerCount, setConnectedPeerCount] = useState(0);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [paymentStage, setPaymentStage] = useState<PaymentStage | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [wizardStep, setWizardStep] = useState<PaymentWizardStep>('scan');
  const [currentPaymentContext, setCurrentPaymentContext] = useState<PaymentContext | null>(null);
  const [lastOfflineRequest, setLastOfflineRequest] = useState<OfflineRequestContext | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [lastBroadcastError, setLastBroadcastError] = useState<string | null>(null);
  const [fallbackModal, setFallbackModal] = useState<FallbackModalState>({ visible: false });

  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowAmount, setEscrowAmount] = useState('10');
  const [creatingEscrow, setCreatingEscrow] = useState(false);
  const [escrowExists, setEscrowExists] = useState(false);
  const [settlementStatus, setSettlementStatus] = useState<string>('');

  // ========== SECURITY FIX: Prevent race conditions on loadData ==========
  const loadingDataRef = useRef(false);

  // NEW: Transaction Success Modal State
  const [txSuccessModal, setTxSuccessModal] = useState<{
    visible: boolean;
    type: 'online' | 'offline' | 'settled';
    amount: number;
    signature?: string;
    bundleId?: string;
  }>({ visible: false, type: 'online', amount: 0 });

  const loadData = useCallback(async () => {
    // ========== SECURITY FIX: Prevent race conditions ==========
    if (loadingDataRef.current) {
      console.log('[CustomerScreen] ⚠️ loadData already in progress, skipping...');
      return;
    }
    loadingDataRef.current = true;

    console.log('[CustomerScreen] ========== loadData CALLED ==========');
    setRefreshing(true);
    try {
      // Ensure wallet is loaded from secure storage
      const walletPubkey = await wallet.loadWallet();
      console.log('[CustomerScreen] Wallet loaded:', walletPubkey?.toBase58());
      const walletAddr = walletPubkey?.toBase58() ?? null;
      setWalletAddress(walletAddr);

      const [transactionsResult, bundlesResult] = await Promise.allSettled([
        bundleTransactionManager.getAllTransactions(),
        bundleStorage.loadBundles(),
      ]);

      const transactions =
        transactionsResult.status === 'fulfilled' ? transactionsResult.value : [];
      if (transactionsResult.status === 'rejected') {
        const reason = transactionsResult.reason;
        console.error(
          '[CustomerScreen] Failed to load transactions:',
          reason instanceof Error ? reason : String(reason),
        );
      }

      const bundles =
        bundlesResult.status === 'fulfilled' ? bundlesResult.value : [];
      if (bundlesResult.status === 'rejected') {
        const reason = bundlesResult.reason;
        console.error(
          '[CustomerScreen] Failed to load pending bundles:',
          reason instanceof Error ? reason : String(reason),
        );
      }

      const pendingMap = new Map<string, PendingBundleListItem>();

      transactions.forEach(tx => {
        if (!tx || !tx.bundle) {
          return;
        }
        pendingMap.set(tx.bundle.tx_id, {
          bundle: tx.bundle,
          state: tx.state,
          updatedAt: tx.timestamp,
          error: tx.error,
        });
      });

      bundles.forEach(bundle => {
        const existing = pendingMap.get(bundle.tx_id);
        if (existing) {
          pendingMap.set(bundle.tx_id, {
            ...existing,
            bundle,
            updatedAt: Math.max(existing.updatedAt ?? 0, bundle.timestamp),
          });
        } else {
          pendingMap.set(bundle.tx_id, {
            bundle,
            state: BundleState.PENDING,
            updatedAt: bundle.timestamp,
          });
        }
      });

      // ========== FIXED: Exclude FAILED bundles from pending list ==========
      const pendingList = Array.from(pendingMap.values())
        .filter(item =>
          item.state !== BundleState.SETTLED &&
          item.state !== BundleState.ROLLBACK &&
          item.state !== BundleState.FAILED  // Don't count failed bundles as pending
        )
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      console.log('[CustomerScreen] Pending bundles loaded:', pendingList.length);
      setPendingBundles(pendingList);
      meshDiagnosticsStore.writeQueueSnapshot('customer', pendingList);

      // Load nonce from storage
      let localNonce = await bundleStorage.loadNonce();
      console.log('[CustomerScreen] Current nonce (local):', localNonce);
      wallet.setNonce(localNonce);

      // Check if online
      console.log('[CustomerScreen] Checking online status...');
      const online = await settlementService.isOnline();
      console.log('[CustomerScreen] Online status:', online);
      setIsOnline(online);

      // ========== NEW: Use centralized BalanceService ==========
      const pubkey = wallet.getPublicKey();
      if (pubkey) {
        try {
          console.log('[CustomerScreen] Fetching balances via BalanceService...');
          const snapshot = await balanceService.getBalance(pubkey, online);
          console.log('[CustomerScreen] ✅ BalanceService returned:', snapshot);

          setWalletSolBalance(snapshot.solBalance);
          setWalletUsdcBalance(snapshot.usdcBalance);
          setEscrowBalance(snapshot.escrowBalance);
          setEscrowExists(snapshot.escrowExists);

          console.log('[CustomerScreen] ✅ All balances loaded:', {
            SOL: snapshot.solBalance,
            USDC: snapshot.usdcBalance,
            Escrow: snapshot.escrowBalance,
            PendingPayments: snapshot.pendingPayments.length,
          });

          // If we have escrow and are online, sync nonce registry
          if (online && snapshot.escrowExists) {
            try {
              const signer = await wallet.getSigner('Sync offline payment state');
              if (signer) {
                settlementService.initializeClient(signer);
                const registry = await settlementService.getNonceRegistrySnapshot(pubkey, signer);
                if (registry) {
                  if (registry.lastNonce > localNonce) {
                    console.log(
                      `[CustomerScreen] Syncing local nonce to on-chain value ${registry.lastNonce}`,
                    );
                    await bundleStorage.saveNonce(registry.lastNonce);
                    wallet.setNonce(registry.lastNonce);
                    localNonce = registry.lastNonce;
                  }

                  const recentHistory = [...registry.bundleHistory].slice(-5).reverse();
                  const recentFraud = [...registry.fraudRecords].slice(-3).reverse();
                  setHistory(recentHistory);
                  setFraudRecords(recentFraud);
                  console.log('[CustomerScreen] History loaded:', recentHistory.length, 'entries');
                }
              }
            } catch (histErr) {
              console.log('[CustomerScreen] Could not sync nonce registry (non-critical):', histErr);
            }
          }
        } catch (err) {
          console.error('[CustomerScreen] ❌ Balance fetch error:', err);
          if (online) {
            Alert.alert(
              'Error',
              'Failed to load wallet data. Please check your connection and try again.',
              [{ text: 'OK' }]
            );
          }
        }
      }
    } catch (err) {
      console.error('[CustomerScreen] ❌ Load error:', err);
      Alert.alert('Error', 'Failed to load customer data. Please try again.');
    } finally {
      setRefreshing(false);
      loadingDataRef.current = false;  // Release mutex
      console.log('[CustomerScreen] ========== loadData COMPLETED ==========');
    }
  }, []);

  const waitForPeerConnection = useCallback(async (timeoutMs = 20000) => {
    if (Platform.OS !== 'android') {
      return;
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (connectedPeersRef.current.size > 0) {
        return;
      }

      const peers = await meshNetworkService.requestPeers();
      const connected = peers.filter(peer => peer.connected);
      if (connected.length > 0) {
        const peersSet = connectedPeersRef.current;
        connected.forEach(peer => peersSet.add(peer.address));
        setConnectedPeerCount(peersSet.size);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error('Unable to find merchant device over Bluetooth. Ensure the merchant app is advertising and try again.');
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!walletAddress) {
      return;
    }

    let cancelled = false;

    const startNode = async () => {
      try {
        setMeshStatus(prev => (prev === 'idle' ? 'scanning' : prev));
        await meshNetworkService.startBLENode(
          {
            serviceUUID: Config.ble.serviceUUID,
            nodeType: 'customer',
            publicKey: walletAddress,
          },
          { forceRestart: true },
        );
        if (!cancelled) {
          setMeshStatus('scanning');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[CustomerScreen] Failed to start mesh node:', error);
          setMeshStatus('error');
          Alert.alert(
            'Bluetooth Error',
            'Failed to start Bluetooth mesh. Please ensure Bluetooth permissions are granted and try again.',
            [{ text: 'OK' }]
          );
        }
      }
    };

    startNode();

    const peersSet = connectedPeersRef.current;
    return () => {
      cancelled = true;
      meshNetworkService.stopBLENode().catch(err => {
        console.warn('[CustomerScreen] Failed to stop mesh node on unmount:', err);
      });
      meshNetworkService.cleanup();
      peersSet.clear();
      setConnectedPeerCount(0);
      setMeshStatus('idle');
    };
  }, [walletAddress]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return () => {};
    }

    const unsubscribeConnections = meshNetworkService.onConnectionStateChange(event => {
      const peers = connectedPeersRef.current;
      if (event.state === 'CONNECTED') {
        peers.add(event.deviceAddress);
        setMeshStatus('connected');
      } else if (event.state === 'DISCONNECTED') {
        peers.delete(event.deviceAddress);
        setMeshStatus(peers.size > 0 ? 'connected' : 'scanning');
      }
      setConnectedPeerCount(peers.size);
    });

    const unsubscribeErrors = meshNetworkService.onError(event => {
      console.error('[CustomerScreen] Mesh network error:', event);
      setMeshStatus('error');
      Alert.alert('Bluetooth Error', event.errorMessage, [{ text: 'OK' }]);
    });

    return () => {
      unsubscribeConnections();
      unsubscribeErrors();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return () => {};
    }

    const unsubscribeScanState = meshNetworkService.onScanStateChange(event => {
      switch (event.status) {
        case 'started':
          if (connectedPeersRef.current.size === 0) {
            setMeshStatus('scanning');
          }
          break;
        case 'stopped':
          if (connectedPeersRef.current.size === 0) {
            setMeshStatus('idle');
          }
          break;
        case 'failed':
          setMeshStatus('error');
          Alert.alert('Bluetooth Error', event.errorMessage ?? 'Bluetooth scan failed. Please retry.', [{ text: 'OK' }]);
          break;
      }
    });

    const unsubscribeScanResult = meshNetworkService.onScanResult(() => {
      if (connectedPeersRef.current.size === 0) {
        setMeshStatus(prev => (prev === 'connected' ? prev : 'connecting'));
      }
    });

    const unsubscribeBroadcast = meshNetworkService.onBundleBroadcast(event => {
      if (!event.success) {
        setMeshStatus(connectedPeersRef.current.size > 0 ? 'connected' : 'scanning');
        if (event.error) {
          Alert.alert('Bluetooth Error', event.error, [{ text: 'OK' }]);
        }
      } else {
        setMeshStatus('connected');
      }
    });

    return () => {
      unsubscribeScanState();
      unsubscribeScanResult();
      unsubscribeBroadcast();
    };
  }, []);


  // Setup network status listener
  useEffect(() => {
    const unsubscribe = networkService.addOnlineListener(online => {
      console.log('[CustomerScreen] Network status changed:', online);
      setIsOnline(online);
      if (online) {
        setSettlementStatus('🌐 Online - Auto-settling...');
        // Trigger data reload when coming online
        loadData();
      } else {
        setSettlementStatus('📡 Offline - Payments stored locally');
      }
    });
    return unsubscribe;
  }, [loadData]);

  // Setup auto-settlement listener
  useEffect(() => {
    const unsubscribe = autoSettlementService.addSettlementListener(event => {
      console.log('[CustomerScreen] Settlement event:', event);
      switch (event.type) {
        case 'attestation_fetched':
          setSettlementStatus(`🔐 Attestation fetched for ${event.bundleId.slice(0, 8)}...`);
          break;
        case 'settlement_started':
          setSettlementStatus(`⏳ Settling ${event.bundleId.slice(0, 8)}...`);
          break;
        case 'settlement_success':
          setSettlementStatus(`✅ Settled! ${event.message}`);
          void loadData();
          Alert.alert(
            'Payment Settled! ✅',
            `Your payment ${event.bundleId.slice(0, 8)}... has been settled on Solana.\n\n${event.message}`,
            [{ text: 'OK', onPress: () => loadData() }]
          );
          break;
        case 'settlement_error':
          setSettlementStatus(`❌ Settlement failed: ${event.error}`);
          break;
      }
    });
    return unsubscribe;
  }, [loadData]);

  // ========== FIXED: Open QR scanner directly, validate AFTER scanning ==========
  const handleScanQRPress = () => {
    console.log('[CustomerScreen] 🔍 Opening QR scanner (balance will be validated after scan)');
    setShowScanner(true);
  };
  // ========== END FIXED ==========

  const handleQRScan = async (qrData: string) => {
    console.log('[CustomerScreen] ========== handleQRScan CALLED ==========');
    console.log('[CustomerScreen] QR data length:', qrData.length);
    console.log('[CustomerScreen] QR data:', qrData);

    setShowScanner(false);
    setLoading(true);

    try {
      // Validate QR data is not empty
      if (!qrData || qrData.trim().length === 0) {
        console.error('[CustomerScreen] ❌ Empty QR code');
        Alert.alert('Invalid QR Code', 'The scanned QR code is empty.');
        return;
      }

      // Safely parse JSON with validation
      let paymentRequest: any;
      try {
        paymentRequest = JSON.parse(qrData);
        console.log('[CustomerScreen] ✅ JSON parsed successfully:', paymentRequest);
      } catch (parseErr) {
        console.error('[CustomerScreen] ❌ JSON parse error:', parseErr);
        Alert.alert('Invalid QR Code', 'The scanned QR code does not contain valid payment data.');
        return;
      }

      // Validate payment request structure
      if (!paymentRequest || typeof paymentRequest !== 'object') {
        console.error('[CustomerScreen] ❌ Invalid payment request structure');
        Alert.alert('Invalid QR Code', 'The scanned QR code does not contain a valid payment request.');
        return;
      }

      if (paymentRequest.type !== 'pay') {
        console.error('[CustomerScreen] ❌ Invalid type:', paymentRequest.type);
        Alert.alert('Invalid QR Code', `This QR code is not a valid payment request (type: ${paymentRequest.type}).`);
        return;
      }

      if (paymentRequest.type === 'beam_bundle' || paymentRequest.bundle) {
        console.warn('[CustomerScreen] Scanned bundle payload on customer device:', paymentRequest);
        Alert.alert(
          'Received bundle QR',
          'You scanned a merchant receipt bundle. Ask the merchant to scan it instead, or use the fallback sharing flow from the Customer screen.',
        );
        return;
      }

      const merchant = paymentRequest.merchant || paymentRequest.merchantPubkey;
      console.log('[CustomerScreen] Merchant address:', merchant);
      if (!merchant || typeof merchant !== 'string') {
        console.error('[CustomerScreen] ❌ Missing merchant address');
        Alert.alert('Invalid Payment Request', 'This QR code is missing a valid merchant address.');
        return;
      }

      // Validate merchant address format (basic Solana public key validation)
      if (merchant.length < 32 || merchant.length > 44) {
        console.error('[CustomerScreen] ❌ Invalid merchant address length:', merchant.length);
        Alert.alert('Invalid Payment Request', 'The merchant address in this QR code is invalid.');
        return;
      }

      // Validate amount
      const amount = paymentRequest.amount;
      console.log('[CustomerScreen] Payment amount:', amount);
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        console.error('[CustomerScreen] ❌ Invalid amount');
        Alert.alert('Invalid Payment Request', 'This QR code contains an invalid payment amount.');
        return;
      }

      if (amount > 1000000000000) {
        console.error('[CustomerScreen] ❌ Amount too large');
        Alert.alert('Invalid Payment Request', 'The payment amount in this QR code is unreasonably large.');
        return;
      }

      console.log('[CustomerScreen] ✅ All validations passed, creating payment...');
      setShowScanner(false);

      const description = paymentRequest.description || 'Payment';
      const amountInSmallestUnit = Math.floor(amount);
      const amountInUsdc = amountInSmallestUnit / 1_000_000;
      const amountLabel =
        paymentRequest.display_amount ??
        `$${amountInUsdc.toFixed(2)} ${paymentRequest.currency ?? 'USDC'}`;
      const merchantName =
        paymentRequest.merchantName ||
        paymentRequest.merchantLabel ||
        undefined;

      setPaymentAmount(amountInSmallestUnit);
      const context: PaymentContext = {
        merchantPubkey: merchant,
        merchantName,
        amountInUsdc,
        amountInSmallestUnit,
        amountLabel,
        description,
        rawRequest: qrData,
      };
      setCurrentPaymentContext(context);
      setLastOfflineRequest({
        ...context,
        bundle: undefined,
      });
      setLastBroadcastError(null);
      setWizardStep('confirm');
    } catch (err) {
      console.error('[CustomerScreen] ❌ Error processing QR code:', err, { qrData });
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to process QR code:\n${message}`);
    } finally {
      setLoading(false);
      console.log('[CustomerScreen] ========== handleQRScan COMPLETED ==========');
    }
  };

  const resetPaymentFlow = useCallback(() => {
    setWizardStep('scan');
    setCurrentPaymentContext(null);
    setLastOfflineRequest(null);
    setLastBroadcastError(null);
    setFallbackModal({ visible: false });
    setPaymentAmount(0);
    setPaymentStage(null);
    setPaymentMessage('');
  }, []);

  const presentFallbackQr = useCallback(async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Fallback not supported', 'Fallback QR is currently supported on Android devices only.');
      return;
    }

    if (!lastOfflineRequest?.bundle) {
      Alert.alert('No bundle available', 'Retry the Bluetooth delivery so Beam can prepare the bundle for fallback.');
      return;
    }

    try {
      const payload = {
        type: 'beam_bundle',
        bundle: encodeOfflineBundle(lastOfflineRequest.bundle),
        payerAttestation: undefined,
      };
      const payloadJson = JSON.stringify(payload);
      const base64 = await QRCodeGenerator.generate(payloadJson, 380);
      setFallbackModal({
        visible: true,
        imageBase64: base64,
        bundleId: lastOfflineRequest.bundle.tx_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Failed to generate fallback QR', message);
    }
  }, [lastOfflineRequest]);

  const createPayment = async (
    merchantPubkey: string,
    amount: number,
    description: string = 'Payment'
  ) => {
    console.log('[CustomerScreen] ========== createPayment CALLED ==========');
    console.log('[CustomerScreen] Merchant:', merchantPubkey);
    console.log('[CustomerScreen] Amount:', amount, 'USDC');
    console.log('[CustomerScreen] Description:', description);

    const payerPubkey = wallet.getPublicKey();
    if (!payerPubkey) {
      console.error('[CustomerScreen] ❌ Wallet not loaded');
      Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
      return;
    }
    console.log('[CustomerScreen] ✅ Payer pubkey:', payerPubkey.toBase58());

    // Check if we have INTERNET connectivity (not just Bluetooth)
    const networkState = await NetInfo.fetch();
    // Only consider WiFi or Cellular as "online" - NOT Bluetooth
    const hasInternet = networkState.isConnected &&
      (networkState.type === 'wifi' || networkState.type === 'cellular');
    console.log('[CustomerScreen] Network type:', networkState.type);
    console.log('[CustomerScreen] Internet status:', hasInternet ? 'ONLINE' : 'OFFLINE');

    // Convert USDC to smallest unit (6 decimals)
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);
    setPaymentAmount(amountInSmallestUnit);

    setIsProcessingPayment(true);
    setLastBroadcastError(null);

    try {
      // ===== NEW: PROPER ONLINE/OFFLINE ROUTING =====
      if (hasInternet) {
        // ONLINE: Direct on-chain settlement (skip BLE)
        console.log('[CustomerScreen] 🌐 Using ONLINE flow - direct settlement');
        setWizardStep('broadcast');
        await createOnlinePayment(merchantPubkey, amountInSmallestUnit, description);
      } else {
        // OFFLINE: BLE payment with connection confirmation
        console.log('[CustomerScreen] 📡 Using OFFLINE BLE flow');
        setWizardStep('connecting');
        await createOfflinePayment(merchantPubkey, amountInSmallestUnit, description);
      }
    } catch (err) {
      console.error('[CustomerScreen] ========== createPayment FAILED ==========');
      console.error('[CustomerScreen] Error:', err);
      setWizardStep('failed');
      throw err;
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const createOnlinePayment = async (
    merchantPubkey: string,
    amountInSmallestUnit: number,
    _description: string
  ) => {
    console.log('[CustomerScreen] 🌐 ONLINE PAYMENT FLOW STARTED');

    const payerPubkey = wallet.getPublicKey();
    if (!payerPubkey) throw new Error('Wallet not loaded');

    // Stage 1: Creating transaction
    setPaymentStage('creating');
    setPaymentMessage('Creating on-chain transaction...');

    try {
      // Get signer for on-chain transaction
      const signer = await wallet.getSigner('Authorize online payment');
      if (!signer) throw new Error('Failed to get wallet signer');

      // Initialize settlement service
      settlementService.initializeClient(signer);

      // Check if escrow needs migration (old 107-byte format)
      const beamClient = new BeamProgramClient(Config.solana.rpcUrl, signer);
      const escrowAccount = await beamClient.getEscrowAccount(payerPubkey);

      if (escrowAccount?.needsMigration) {
        console.log('[CustomerScreen] ⚠️  Escrow needs migration from old format');
        setPaymentMessage('Upgrading escrow account...');

        try {
          const migrationTx = await beamClient.migrateEscrow();
          console.log('[CustomerScreen] ✅ Migration successful:', migrationTx);
          setPaymentMessage('Escrow upgraded! Continuing payment...');
          await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause to let migration settle
        } catch (migrationErr) {
          console.error('[CustomerScreen] ❌ Migration failed:', migrationErr);
          throw new Error(`Failed to upgrade escrow account: ${migrationErr instanceof Error ? migrationErr.message : String(migrationErr)}`);
        }
      }

      // Check escrow balance
      const escrowBalanceRaw = await settlementService.getEscrowBalance(payerPubkey);
      if (escrowBalanceRaw < amountInSmallestUnit) {
        throw new Error(`Insufficient escrow balance. Have: ${escrowBalanceRaw}, Need: ${amountInSmallestUnit}`);
      }

      // Stage 2: Signing
      setPaymentStage('signing');
      setPaymentMessage('Signing transaction...');

      // Create and execute direct on-chain settlement
      const merchantPubkeyObj = new PublicKey(merchantPubkey);

      // Stage 3: Submitting
      setPaymentStage('broadcasting');
      setPaymentMessage('Submitting to Solana...');

      // NEW: Direct payment without attestation (program now accepts optional)
      const signature = await settlementService.settleDirectPaymentOnline(
        merchantPubkeyObj,
        amountInSmallestUnit,
        signer
      );

      // Stage 4: Success
      setPaymentStage('success');
      setPaymentMessage('Payment settled on-chain!');

      // NEW: Show transaction success modal with explorer link
      setTxSuccessModal({
        visible: true,
        type: 'online',
        amount: amountInSmallestUnit / 1_000_000,
        signature: signature,
      });

      setWizardStep('complete');
      setLastOfflineRequest(null);

      // Reload data to update balances
      await loadData();

    } catch (err) {
      console.error('[CustomerScreen] ❌ Online payment failed:', err);
      setPaymentStage('error');
      setPaymentMessage('Payment failed');
      throw err;
    } finally {
      // Clear animation
      setTimeout(() => {
        setPaymentStage(null);
        setPaymentMessage('');
      }, 3000);
    }
  };

  const createOfflinePayment = async (
    merchantPubkey: string,
    amountInSmallestUnit: number,
    _description: string
  ) => {
    console.log('[CustomerScreen] 📡 OFFLINE PAYMENT FLOW STARTED');

    const payerPubkey = wallet.getPublicKey();
    if (!payerPubkey) {
      throw new Error('Wallet not loaded');
    }

    // ========== CRITICAL SECURITY CHECK: Validate Balance BEFORE Creating Payment ==========
    // Calculate pending offline payments that haven't settled yet
    const pendingOfflineAmount = pendingBundles.reduce((sum, item) => {
      const state = item.state;
      // Only count bundles that are still pending settlement (not settled or failed)
      if (state !== BundleState.SETTLED && state !== BundleState.FAILED && state !== BundleState.ROLLBACK) {
        return sum + (item.bundle.token?.amount ?? 0);
      }
      return sum;
    }, 0);

    // Convert pending and requested amounts to USDC (escrowBalance is already in USDC from BalanceService)
    const pendingInUsdc = pendingOfflineAmount / 1_000_000;
    const requestedInUsdc = amountInSmallestUnit / 1_000_000;
    const availableInUsdc = escrowBalance - pendingInUsdc;

    console.log('[CustomerScreen] 💰 Balance Check:', {
      escrow: escrowBalance,
      pending: pendingInUsdc,
      available: availableInUsdc,
      requested: requestedInUsdc,
    });

    if (escrowBalance <= 0) {
      throw new Error(
        '❌ No Escrow Balance\n\n' +
        'You need to create and fund your escrow account before making offline payments.\n\n' +
        'Please go online and:\n' +
        '1. Create escrow account\n' +
        '2. Add funds to your escrow\n' +
        '3. Then you can make offline payments'
      );
    }

    if (requestedInUsdc > availableInUsdc) {
      throw new Error(
        '❌ Insufficient Available Balance\n\n' +
        `Escrow Balance: ${escrowBalance.toFixed(2)} USDC\n` +
        `Pending Offline: ${pendingInUsdc.toFixed(2)} USDC\n` +
        `Available: ${availableInUsdc.toFixed(2)} USDC\n` +
        `Requested: ${requestedInUsdc.toFixed(2)} USDC\n\n` +
        (pendingOfflineAmount > 0
          ? 'You have pending offline payments. Please settle them online first or add more funds to your escrow.'
          : 'Please add more funds to your escrow account.')
      );
    }

    console.log('[CustomerScreen] ✅ Balance check passed - proceeding with offline payment');
    // ========== END SECURITY CHECK ==========

    const meshConfig: MeshNetworkConfig = {
      serviceUUID: Config.ble.serviceUUID,
      nodeType: 'customer',
      publicKey: payerPubkey.toBase58(),
    };

    connectedPeersRef.current.clear();
    setConnectedPeerCount(0);
    setMeshStatus('scanning');

    await meshNetworkService.startBLENode(meshConfig, { forceRestart: true });

    setMeshStatus('connecting');
    await waitForPeerConnection();

    try {
      const readyAddress = await meshNetworkService.waitForPeerReady({
        merchantPubkey,
        timeoutMs: 15000,
      });
      console.log('[CustomerScreen] Peer ready for transfer:', readyAddress);
    } catch (readyError) {
      console.error('[CustomerScreen] Peer readiness wait failed:', readyError);
      throw readyError;
    }

    try {
      setPaymentStage('broadcasting');
      setPaymentMessage('Preparing payment bundle...');

      const escrowPDA = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), payerPubkey.toBuffer()],
        new PublicKey(Config.program.id)
      )[0].toBase58();
      const tokenMint = Config.tokens.usdc.mint;
      const tokenDecimals = Config.tokens.usdc.decimals;

      const nonce = await bundleStorage.incrementNonce();
      wallet.setNonce(nonce);

      const unsignedBundle = createUnsignedBundle(
        escrowPDA,
        payerPubkey.toBase58(),
        merchantPubkey,
        amountInSmallestUnit,
        tokenMint,
        tokenDecimals,
        nonce
      );

      console.log('[CustomerScreen] Unsigned bundle object:', unsignedBundle);
      console.log('[CustomerScreen] Token field details:', JSON.stringify(unsignedBundle.token, null, 2));
      const serialized = serializeBundle(unsignedBundle);
      const messageHash = sha256(serialized); // Hash the serialized bundle before signing
      const payerSignature = await attestationService.signPayload(messageHash, 'Authorize offline payment');
      console.log('[CustomerScreen] Canonical bundle JSON:', Buffer.from(serialized).toString('utf8'));
      console.log('[CustomerScreen] Message hash (hex):', Buffer.from(messageHash).toString('hex'));
      console.log('[CustomerScreen] Payer signature (hex):', Buffer.from(payerSignature).toString('hex'));
      const bundle: OfflineBundle = {
        ...unsignedBundle,
        payer_signature: payerSignature,
        merchant_signature: undefined, // Explicitly set to undefined - merchant will add their signature
      };
      console.log('[CustomerScreen] Final bundle before BLE transmission:', {
        tx_id: bundle.tx_id,
        token: bundle.token,
        payer_signature_length: bundle.payer_signature?.length,
        merchant_signature: bundle.merchant_signature,
      });

      const metadata = {
        amount: bundle.token.amount,
        currency: bundle.token.symbol ?? 'USDC',
        merchantPubkey: bundle.merchant_pubkey,
        payerPubkey: bundle.payer_pubkey,
        nonce: bundle.nonce,
        createdAt: Date.now(),
      };

      await bundleTransactionManager.createBundle({
        bundle,
        metadata,
        selfRole: 'payer',
      });

      await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.QUEUED);

      // ========== NEW: Add optimistic balance update ==========
      if (walletAddress) {
        const amountInUsdc = amountInSmallestUnit / 1_000_000;
        await balanceService.addPendingPayment(
          walletAddress,
          bundle.tx_id,
          amountInUsdc,
          'sent'
        );
        console.log('[CustomerScreen] ✅ Added pending payment to balance cache:', amountInUsdc, 'USDC');
        // Update local state to reflect the pending payment
        setEscrowBalance(prev => Math.max(0, prev - amountInUsdc));
      }

      setLastOfflineRequest(prev => {
        if (prev) {
          return { ...prev, bundle };
        }
        const amountInUsdc = amountInSmallestUnit / 1_000_000;
        return {
          merchantPubkey,
          merchantName: currentPaymentContext?.merchantName,
          amountInUsdc,
          amountInSmallestUnit,
          amountLabel: `$${amountInUsdc.toFixed(2)} ${bundle.token?.symbol ?? 'USDC'}`,
          description: currentPaymentContext?.description ?? 'Offline payment',
          rawRequest: currentPaymentContext?.rawRequest,
          bundle,
        };
      });

      setPaymentMessage('Sending payment via Bluetooth...');
      setWizardStep('broadcast');

      const cleanBundle: OfflineBundle = {
        tx_id: bundle.tx_id,
        escrow_pda: bundle.escrow_pda,
        token: {
          symbol: bundle.token.symbol,
          mint: bundle.token.mint,
          decimals: bundle.token.decimals,
          amount: bundle.token.amount,
        },
        payer_pubkey: bundle.payer_pubkey,
        merchant_pubkey: bundle.merchant_pubkey,
        nonce: bundle.nonce,
        timestamp: bundle.timestamp,
        version: bundle.version,
        payer_signature: bundle.payer_signature,
        merchant_signature: undefined,
      };

      console.log('[CustomerScreen] 🔍 CLEAN BUNDLE TOKEN BEFORE BLE:', JSON.stringify(cleanBundle.token, null, 2));
      console.log('[CustomerScreen] 🔍 CLEAN BUNDLE payer_sig length:', cleanBundle.payer_signature?.length);

      let attempts = 0;
      let delivered = false;
      let lastError: unknown = null;

      while (attempts < 3 && !delivered) {
        try {
          await meshNetworkService.waitForPeerReady({ merchantPubkey, timeoutMs: 6000 });
          const result = await meshNetworkService.broadcastBundle(cleanBundle, { config: meshConfig });
          delivered = result.success && result.peersReached > 0;
          if (!delivered) {
            await waitForPeerConnection(4000);
          }
        } catch (error) {
          console.error('[CustomerScreen] Broadcast attempt failed:', error);
          lastError = error;
          await waitForPeerConnection(4000);
        }
        attempts += 1;
      }

      if (!delivered) {
        const message =
          lastError instanceof Error
            ? lastError.message
            : 'Failed to deliver bundle via Bluetooth. Ensure the merchant app is active and try again.';
        const annotatedMessage = buildOfflineFailureMessage(message);
        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.FAILED, {
          error: annotatedMessage,
        });
        // ========== FIX Bug #8: Don't reload full data, just refresh pending list ==========
        const bundles = await bundleStorage.loadBundles();
        setPendingBundles(bundles.map(b => ({ bundle: b, state: BundleState.PENDING, updatedAt: b.timestamp })));
        setLastBroadcastError(annotatedMessage);
        throw new Error(annotatedMessage);
      }

      await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.BROADCAST);

      setMeshStatus('connected');
      setPaymentStage('success');
      setPaymentMessage('Payment sent successfully!');
      setTxSuccessModal({
        visible: true,
        type: 'offline',
        amount: amountInSmallestUnit / 1_000_000,
        bundleId: bundle.tx_id,
      });

      // ========== FIX Bug #8: Don't reload full data, just refresh pending list ==========
      const bundles = await bundleStorage.loadBundles();
      setPendingBundles(bundles.map(b => ({ bundle: b, state: BundleState.PENDING, updatedAt: b.timestamp })));
      setLastOfflineRequest(null);
      setWizardStep('complete');
      setLastBroadcastError(null);
    } finally {
      setPaymentStage(null);
      setPaymentMessage('');
      if (connectedPeersRef.current.size === 0) {
        setMeshStatus('scanning');
      }
    }
  };

  const handleConfirmPayment = async () => {
    if (!currentPaymentContext) {
      Alert.alert('No payment selected', 'Scan a merchant QR code to start a payment.');
      return;
    }

    try {
      setLastBroadcastError(null);
      await createPayment(
        currentPaymentContext.merchantPubkey,
        currentPaymentContext.amountInUsdc,
        currentPaymentContext.description,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastBroadcastError(message);
      setWizardStep('failed');
      Alert.alert('Payment failed', message);
    }
  };

  const handleRetryPayment = async () => {
    await handleConfirmPayment();
  };

  const handleRetryBundleDelivery = useCallback(
    async (item: PendingBundleListItem) => {
      const { bundle } = item;
      const payerPubkey = wallet.getPublicKey();
      if (!payerPubkey) {
        Alert.alert('Wallet not ready', 'Load your wallet before retrying bundle delivery.');
        return;
      }

      const amountInUsdc = bundle.token.amount / 1_000_000;
      const context: PaymentContext = {
        merchantPubkey: bundle.merchant_pubkey,
        merchantName: currentPaymentContext?.merchantName ?? bundle.merchant_pubkey,
        amountInUsdc,
        amountInSmallestUnit: bundle.token.amount,
        amountLabel: `$${amountInUsdc.toFixed(2)} ${bundle.token.symbol ?? 'USDC'}`,
        description: 'Retry offline delivery',
        rawRequest: lastOfflineRequest?.rawRequest,
      };
      setCurrentPaymentContext(context);
      setLastOfflineRequest({ ...context, bundle });
      setPaymentAmount(bundle.token.amount);
      setIsProcessingPayment(true);
      setPaymentStage('broadcasting');
      setPaymentMessage('Retrying Bluetooth delivery…');
      setLastBroadcastError(null);
      setWizardStep('connecting');

      const meshConfig: MeshNetworkConfig = {
        serviceUUID: Config.ble.serviceUUID,
        nodeType: 'customer',
        publicKey: payerPubkey.toBase58(),
      };

      try {
        connectedPeersRef.current.clear();
        setConnectedPeerCount(0);
        setMeshStatus('scanning');
        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.QUEUED);
        await meshNetworkService.startBLENode(meshConfig, { forceRestart: true });
        await waitForPeerConnection();
        await meshNetworkService.waitForPeerReady({ merchantPubkey: bundle.merchant_pubkey, timeoutMs: 15000 });

        setWizardStep('broadcast');
        await meshNetworkService.waitForPeerReady({ merchantPubkey: bundle.merchant_pubkey, timeoutMs: 6000 });

        // CRITICAL: Create clean bundle copy for BLE transmission
        const cleanRetryBundle: OfflineBundle = {
          tx_id: bundle.tx_id,
          escrow_pda: bundle.escrow_pda,
          token: {
            symbol: bundle.token.symbol,
            mint: bundle.token.mint,
            decimals: bundle.token.decimals,
            amount: bundle.token.amount,
          },
          payer_pubkey: bundle.payer_pubkey,
          merchant_pubkey: bundle.merchant_pubkey,
          nonce: bundle.nonce,
          timestamp: bundle.timestamp,
          version: bundle.version,
          payer_signature: bundle.payer_signature,
          merchant_signature: bundle.merchant_signature,
        };
        console.log('[CustomerScreen] 🔄 RETRY: Clean bundle token:', JSON.stringify(cleanRetryBundle.token, null, 2));

        const result = await meshNetworkService.broadcastBundle(cleanRetryBundle, { config: meshConfig });
        const delivered = result.success && (result.peersReached ?? 0) > 0;
        if (!delivered) {
          throw new Error('Failed to deliver bundle via Bluetooth. Ensure the merchant device is active nearby and try again.');
        }

        setMeshStatus('connected');
        setWizardStep('complete');
        setLastOfflineRequest(null);
        setLastBroadcastError(null);
        setTxSuccessModal({
          visible: true,
          type: 'offline',
          amount: amountInUsdc,
          bundleId: bundle.tx_id,
        });

        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.BROADCAST);
        await loadData();
      } catch (error) {
        const baseMessage = error instanceof Error ? error.message : String(error);
        const formattedMessage = buildOfflineFailureMessage(baseMessage);
        setLastBroadcastError(formattedMessage);
        setWizardStep('failed');
        Alert.alert('Retry failed', formattedMessage);
        await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.FAILED, {
          error: formattedMessage,
        });
        await loadData();
      } finally {
        setIsProcessingPayment(false);
        setPaymentStage(null);
        setPaymentMessage('');
        if (connectedPeersRef.current.size === 0) {
          setMeshStatus('scanning');
        }
      }
    },
    [currentPaymentContext, waitForPeerConnection, lastOfflineRequest, loadData],
  );

  const handleRemoveBundle = useCallback(
    (item: PendingBundleListItem) => {
      const { bundle } = item;
      Alert.alert(
        'Remove offline bundle',
        'Removing the bundle will delete it from this device. Only do this if you have already settled it elsewhere or it is no longer needed.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await bundleTransactionManager.deleteBundle(bundle.tx_id);
                await loadData();
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Alert.alert('Failed to remove bundle', message);
              }
            },
          },
        ],
      );
    },
    [loadData],
  );

  const createEscrow = async () => {
    console.log('[CustomerScreen] ========== createEscrow CALLED ==========');

    // Validate input
    const amount = parseFloat(escrowAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }

    if (amount > walletUsdcBalance) {
      Alert.alert(
        'Insufficient Balance',
        `You only have ${walletUsdcBalance.toFixed(2)} USDC in your wallet.\n\nYou need at least ${amount.toFixed(2)} USDC to create the escrow.`
      );
      return;
    }

    if (!isOnline) {
      Alert.alert('Offline', 'Cannot create escrow while offline. Please connect to internet.');
      return;
    }

    // Get signer
    const signer = await wallet.getSigner('Create escrow account');
    if (!signer) {
      Alert.alert('Error', 'Failed to access wallet signer');
      return;
    }

    setCreatingEscrow(true);
    setShowEscrowModal(false);
    let action: 'initialize' | 'fund' = 'initialize';

    try {
      console.log('[CustomerScreen] Creating escrow with amount:', amount, 'USDC');

      // Convert USDC to smallest unit (6 decimals)
      const amountInSmallestUnit = Math.floor(amount * 1_000_000);
      console.log('[CustomerScreen] Amount in smallest unit:', amountInSmallestUnit);

      // Initialize BeamProgramClient with real signer
      const { BeamProgramClient: BeamProgramClientModule } = require('../solana/BeamProgram');
      const beamClient = new BeamProgramClientModule(Config.solana.rpcUrl, signer);
      const payerPubkey = wallet.getPublicKey();
      if (!payerPubkey) {
        throw new Error('Wallet not loaded');
      }

      try {
        const existingEscrow = await beamClient.getEscrowAccount(payerPubkey);
        if (existingEscrow) {
          action = 'fund';
        }
      } catch (probeErr) {
        console.log('[CustomerScreen] Escrow existence probe failed, defaulting to initialize:', probeErr);
      }

      console.log('[CustomerScreen] Processing escrow action:', action);
      const txSignature =
        action === 'fund'
          ? await beamClient.fundEscrow(amountInSmallestUnit)
          : await beamClient.initializeEscrow(amountInSmallestUnit);
      console.log(
        `[CustomerScreen] ✅ Escrow ${action === 'fund' ? 'funded' : 'created'}! Transaction:`,
        txSignature,
      );

      // Wait for confirmation
      console.log('[CustomerScreen] Waiting for transaction confirmation...');
      const connection = beamClient.getConnection();
      await connection.confirmTransaction(txSignature, Config.solana.commitment);
      console.log('[CustomerScreen] ✅ Transaction confirmed!');

      // Update UI
      await loadData();

      const successTitle = action === 'fund' ? 'Escrow Topped Up!' : 'Escrow Created Successfully!';
      const successMessage =
        action === 'fund'
          ? `Added ${amount.toFixed(2)} USDC to your escrow balance.\n\nTransaction: ${txSignature.slice(0, 8)}...${txSignature.slice(-8)}\n\nNew balance will appear shortly.`
          : `Your escrow account has been created and funded with ${amount.toFixed(2)} USDC.\n\nTransaction: ${txSignature.slice(0, 8)}...${txSignature.slice(-8)}\n\nYou can now create offline payments!`;

      Alert.alert(
        successTitle,
        successMessage,
        [{ text: 'OK' }]
      );

    } catch (err) {
      console.error('[CustomerScreen] ❌ Error creating escrow:', err);
      const message = err instanceof Error ? err.message : String(err);

      // Provide helpful error messages
      let errorTitle = action === 'fund' ? 'Escrow Top-up Failed' : 'Escrow Creation Failed';
      let errorMessage = message;

      if (message.includes('insufficient funds')) {
        errorTitle = 'Insufficient Funds';
        errorMessage = 'You do not have enough SOL to pay for the transaction fee.\n\nPlease ensure you have at least 0.01 SOL in your wallet.';
      } else if (message.includes('already in use')) {
        errorTitle = 'Escrow Already Exists';
        errorMessage = 'Your escrow account already exists. Refresh your balances and try topping up instead.';
      } else if (message.includes('blockhash')) {
        errorTitle = 'Network Issue';
        errorMessage = 'The transaction could not be confirmed. Please check your internet connection and try again.';
      }

      Alert.alert(errorTitle, errorMessage);
    } finally {
      setCreatingEscrow(false);
      console.log('[CustomerScreen] ========== createEscrow COMPLETED ==========');
    }
  };

  // ========== FIXED: Only count actually pending bundles (exclude FAILED, SETTLED, ROLLBACK) ==========
  const totalPending = pendingBundles.reduce((sum, item) => {
    if (item.state !== BundleState.SETTLED && item.state !== BundleState.FAILED && item.state !== BundleState.ROLLBACK) {
      return sum + (item.bundle.token?.amount ?? 0) / 1_000_000;
    }
    return sum;
  }, 0);
  const meshQueueStatus =
    meshStatus === 'connected'
      ? 'online'
      : meshStatus === 'scanning' || meshStatus === 'connecting'
      ? 'pending'
      : 'offline';
  const meshQueueLabel = (() => {
    switch (meshStatus) {
      case 'connected':
        return connectedPeerCount > 0
          ? `Connected (${connectedPeerCount})`
          : 'Connected';
      case 'scanning':
        return 'Scanning…';
      case 'connecting':
        return 'Connecting…';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  })();

  const formatPubkey = useCallback((pubkey: string) => {
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
  }, []);

  const wizardMerchantName =
    currentPaymentContext?.merchantName?.length
      ? currentPaymentContext.merchantName
      : currentPaymentContext
      ? formatPubkey(currentPaymentContext.merchantPubkey)
      : undefined;

  const wizardAmountLabel =
    currentPaymentContext?.amountLabel ??
    (currentPaymentContext
      ? `$${currentPaymentContext.amountInUsdc.toFixed(2)} USDC`
      : lastOfflineRequest
      ? `$${lastOfflineRequest.amountInUsdc.toFixed(2)} USDC`
      : undefined);

  let wizardTips: string[] | undefined;
  if (wizardStep === 'failed' && lastBroadcastError) {
    wizardTips = [
      lastBroadcastError,
      'Stay within two meters of the merchant and ensure Bluetooth is enabled.',
    ];
  } else if (wizardStep === 'complete' && !isOnline) {
    wizardTips = [
      'Bundles remain queued locally until Beam reconnects.',
      'Keep the device online to auto-settle on the network.',
    ];
  }

  let wizardPrimaryAction:
    | {
        label: string;
        onPress: () => void;
        variant?: 'primary' | 'secondary' | 'ghost';
        disabled?: boolean;
      }
    | undefined;
  let wizardSecondaryAction:
    | {
        label: string;
        onPress: () => void;
        variant?: 'primary' | 'secondary' | 'ghost';
        disabled?: boolean;
      }
    | undefined;

  switch (wizardStep) {
    case 'scan':
      wizardPrimaryAction = {
        label: 'Scan merchant QR',
        onPress: handleScanQRPress, // Pre-flight balance check before opening scanner
        disabled: loading || isProcessingPayment,
      };
      break;
    case 'confirm':
      wizardPrimaryAction = {
        label: isOnline ? 'Send payment' : 'Send offline bundle',
        onPress: () => {
          void handleConfirmPayment();
        },
        disabled: isProcessingPayment,
      };
      wizardSecondaryAction = {
        label: 'Cancel',
        onPress: resetPaymentFlow,
        variant: 'secondary',
        disabled: isProcessingPayment,
      };
      break;
    case 'connecting':
      wizardPrimaryAction = {
        label: 'Connecting…',
        onPress: () => {},
        disabled: true,
      };
      wizardSecondaryAction = lastOfflineRequest?.bundle
        ? {
            label: 'Show fallback QR',
            onPress: () => {
              void presentFallbackQr();
            },
            variant: 'secondary',
            disabled: isProcessingPayment,
          }
        : {
            label: 'Cancel',
            onPress: resetPaymentFlow,
            variant: 'secondary',
            disabled: isProcessingPayment,
          };
      break;
    case 'broadcast':
      wizardPrimaryAction = {
        label: 'Sending…',
        onPress: () => {},
        disabled: true,
      };
      wizardSecondaryAction = lastOfflineRequest?.bundle
        ? {
            label: 'Show fallback QR',
            onPress: () => {
              void presentFallbackQr();
            },
            variant: 'secondary',
            disabled: isProcessingPayment,
          }
        : undefined;
      break;
    case 'complete':
      wizardPrimaryAction = {
        label: 'Start new payment',
        onPress: resetPaymentFlow,
      };
      break;
    case 'failed':
      wizardPrimaryAction = {
        label: 'Retry Bluetooth delivery',
        onPress: () => {
          void handleRetryPayment();
        },
        disabled: isProcessingPayment,
      };
      wizardSecondaryAction = lastOfflineRequest?.bundle
        ? {
            label: 'Show fallback QR',
            onPress: () => {
              void presentFallbackQr();
            },
            variant: 'secondary',
            disabled: isProcessingPayment,
          }
        : {
            label: 'Cancel',
            onPress: resetPaymentFlow,
            variant: 'ghost',
            disabled: isProcessingPayment,
          };
      break;
    default:
      break;
  }

  const onlineBadge = (
    <StatusBadge
      status={isOnline ? 'online' : 'offline'}
      label={isOnline ? 'Verifier connected' : 'Verifier offline'}
      icon={isOnline ? '🛰️' : '⚠️'}
    />
  );

  return (
    <>
      <Screen
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={palette.accentBlue} />}
        header={
          <Hero
            chip={onlineBadge}
            title="Customer"
            subtitle={
              pendingBundles.length > 0
                ? `You have ${pendingBundles.length} offline bundle${pendingBundles.length === 1 ? '' : 's'} ready to settle.`
                : 'Create offline bundles anytime — they sync automatically once online.'
            }
            right={
              <View style={{ gap: spacing.sm }}>
                <Card variant="glass" padding="md" style={styles.heroCard}>
                  <Small style={styles.labelMuted}>Wallet Balance</Small>
                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <HeadingM>{walletSolBalance.toFixed(3)} SOL</HeadingM>
                      <Small style={styles.balanceSub}>Native token</Small>
                    </View>
                    <View style={{ flex: 1 }}>
                      <HeadingM>${walletUsdcBalance.toFixed(2)}</HeadingM>
                      <Small style={styles.balanceSub}>USDC</Small>
                    </View>
                  </View>
                </Card>
                <Card variant="glass" padding="md" style={styles.heroCard}>
                  <Small style={styles.labelMuted}>
                    {escrowExists ? 'Escrow Balance' : 'No Escrow Yet'}
                  </Small>
                  <HeadingL style={{ marginTop: spacing.xs }}>
                    ${escrowBalance.toFixed(2)} USDC
                  </HeadingL>

                  {(() => {
                    // Calculate pending offline payments (only unsettled bundles)
                    const pendingOfflineAmount = pendingBundles.reduce((sum, item) => {
                      const state = item.state;
                      if (state !== BundleState.SETTLED && state !== BundleState.FAILED && state !== BundleState.ROLLBACK) {
                        return sum + (item.bundle.token?.amount ?? 0);
                      }
                      return sum;
                    }, 0);
                    // escrowBalance is already in USDC, pendingOfflineAmount is in smallest units
                    const pendingInUsdc = pendingOfflineAmount / 1_000_000;
                    const availableInUsdc = escrowBalance - pendingInUsdc;

                    if (escrowBalance > 0 && pendingOfflineAmount > 0) {
                      return (
                        <View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Small style={styles.balanceLabel}>Pending Offline:</Small>
                            <Small style={styles.balanceValue}>-${pendingInUsdc.toFixed(2)} USDC</Small>
                          </View>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: palette.neutral[700], paddingTop: spacing.xs }}>
                            <Small style={[styles.balanceLabel, { fontWeight: '600' }]}>Available:</Small>
                            <Small style={[styles.balanceValue, { fontWeight: '600', color: availableInUsdc > 0 ? palette.success : palette.error }]}>
                              ${availableInUsdc.toFixed(2)} USDC
                            </Small>
                          </View>
                        </View>
                      );
                    }
                    return null;
                  })()}

                  <Body style={styles.heroSub}>
                    {escrowBalance > 0
                      ? (isOnline ? 'Live from chain' : 'Last known balance')
                      : escrowExists
                        ? (isOnline ? 'Escrow ready — add funds to pay' : 'Escrow ready — add funds when online')
                        : 'Create escrow to start payments'}
                  </Body>
                  {!escrowExists && isOnline && (
                    <Button
                      label="Create Escrow"
                      icon={<TextIcon label="🔐" />}
                      onPress={() => setShowEscrowModal(true)}
                      style={{ marginTop: spacing.sm }}
                      variant="primary"
                    />
                  )}
                </Card>
              </View>
            }
          />
        }
      >
        <Section
          title="Send a payment"
          description="Follow the guided steps to scan, confirm, and deliver bundles even without network access."
        >
          <PaymentFlowWizard
            step={wizardStep}
            merchantName={wizardMerchantName}
            amountLabel={wizardAmountLabel}
            tips={wizardTips}
            primaryAction={wizardPrimaryAction}
            secondaryAction={wizardSecondaryAction}
          />
          {lastBroadcastError && wizardStep === 'failed' ? (
            <Card variant="highlight" style={styles.errorCard}>
              <Small style={styles.errorCopy}>{lastBroadcastError}</Small>
            </Card>
          ) : null}
          <Button
            label="Diagnostics"
            icon={<TextIcon label="🛠️" />}
            variant="ghost"
            onPress={() => setDiagnosticsVisible(true)}
            style={styles.diagnosticsButton}
          />
        </Section>

        {/* Payment Flow Animation */}
        {paymentStage && (
          <PaymentFlowAnimation
            stage={paymentStage}
            message={paymentMessage}
            amount={paymentAmount}
          />
        )}

        {/* Security & Network Status */}
        <SecurityStatusCard />
        <MeshNetworkStatus
          isScanning={meshStatus === 'scanning' || meshStatus === 'connecting'}
          isAdvertising={false}
          connectedPeers={connectedPeerCount}
          statusLabelOverride={meshQueueLabel}
        />
        {settlementStatus ? (
          <Section title="Status" description="Real-time payment processing updates">
            <Card variant="highlight" style={styles.statusCard}>
              <Body style={styles.statusText}>{settlementStatus}</Body>
            </Card>
          </Section>
        ) : null}

        <Section
          title="Payment bundles"
          description={isOnline ? 'Payments auto-settle on Solana when online. No manual action required.' : 'Payments stored locally. Will auto-settle when you come online.'}
        >
          <Card style={styles.metricsCard}>
            <View style={styles.metricsRow}>
              <Metric
                label="Bundles"
                value={pendingBundles.length.toString()}
                caption="Awaiting settlement"
                accent="purple"
              />
              <Metric
                label="USDC pending"
                value={`$${totalPending.toFixed(2)}`}
                caption="Across queued bundles"
                accent="blue"
              />
              <Metric
                label="Nonce"
                value={wallet.getCurrentNonce().toString()}
                caption="Latest issued"
                accent="green"
              />
            </View>

            <Small style={styles.helperText}>
              {isOnline
                ? 'Online: payments will settle on Solana automatically.'
                : 'Offline: payments stored locally, will settle when online.'}
            </Small>
          </Card>
          <View style={styles.bundleListContainer}>
            <PendingBundleList
              items={pendingBundles}
              onRetry={handleRetryBundleDelivery}
              onRemove={handleRemoveBundle}
            />
          </View>
        </Section>

        {/* Transaction History */}
        <TransactionHistory transactions={history} />

        {fraudRecords.length > 0 ? (
          <Section
            title="Dispute log"
            description="Verifier reports highlighting conflicting bundle evidence."
          >
            <Card variant="highlight" style={styles.fraudCard}>
              {fraudRecords.map(entry => (
                <View key={`${entry.bundleHash}-${entry.reportedAt}`} style={styles.fraudRow}>
                  <View style={styles.fraudContent}>
                    <HeadingM>
                      {entry.reason === 'duplicateBundle' ? 'Duplicate bundle reported' : 'Attestation issue reported'}
                    </HeadingM>
                    <Body style={styles.helperText}>
                      {`Reported ${new Date(entry.reportedAt).toLocaleString()} by ${entry.reporter
                        .toBase58()
                        .slice(0, 12)}…`}
                    </Body>
                  </View>
                  <Small style={styles.hashLabel}>{entry.conflictingHash.slice(0, 10)}…</Small>
                </View>
              ))}
            </Card>
          </Section>
        ) : null}


        <Section
          title="Resilience diagnostics"
          description="Ensure Beam services are healthy before large settlement batches."
        >
          <Card style={styles.diagnosticsCard}>
            <View style={styles.diagnosticsRow}>
              <StatusBadge
                status={isOnline ? 'online' : 'degraded'}
                label={isOnline ? 'RPC reachable' : 'Waiting for network'}
                icon="🌐"
              />
              <StatusBadge
                status={pendingBundles.length > 0 ? 'pending' : 'online'}
                label={pendingBundles.length > 0 ? 'Bundles queued' : 'No queue'}
                icon="🗂️"
              />
              <StatusBadge
                status={meshQueueStatus}
                label={meshQueueLabel}
                icon={
                  meshStatus === 'connected'
                    ? '✅'
                    : meshStatus === 'scanning' || meshStatus === 'connecting'
                    ? '📡'
                    : meshStatus === 'error'
                    ? '⚠️'
                    : '🛑'
                }
              />
              <StatusBadge status="online" label="Secure enclave" icon="🔐" />
            </View>
          </Card>
        </Section>
      </Screen>

      {
        loading ? (
          <View style={styles.loadingOverlay} >
            <Card variant="glass" padding="lg" style={styles.loadingCard}>
              <ActivityIndicator size="large" color={palette.accentBlue} />
              <Body style={styles.loadingBody}>Authorizing Solana transactions…</Body>
            </Card>
          </View>
        ) : null
      }

      <Modal visible={showScanner} animationType="slide" presentationStyle="fullScreen">
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      </Modal>

      <MeshDiagnosticsModal
        visible={diagnosticsVisible}
        onClose={() => setDiagnosticsVisible(false)}
      />

      <Modal
        visible={fallbackModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setFallbackModal({ visible: false })}
      >
        <View style={styles.modalOverlay}>
          <Card variant="glass" style={styles.fallbackModalCard}>
            <HeadingM style={styles.modalTitle}>Share fallback QR</HeadingM>
            <Body style={styles.fallbackDescription}>
              If Bluetooth isn’t working, ask the merchant to scan this QR code to receive the bundle securely.
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

      {/* NEW: BLE Connection Modal */}
      {/* Connection modal removed; mesh status displayed via MeshNetworkStatus */}

      {/* NEW: Transaction Success Modal */}
      <TransactionSuccessModal
        visible={txSuccessModal.visible}
        type={txSuccessModal.type}
        role="customer"
        amount={txSuccessModal.amount}
        signature={txSuccessModal.signature}
        bundleId={txSuccessModal.bundleId}
        onClose={() => {
          setTxSuccessModal({ ...txSuccessModal, visible: false });
          loadData(); // Refresh balances after closing
        }}
      />

      <Modal
        visible={showEscrowModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEscrowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Card variant="glass" style={styles.escrowModalCard}>
            <HeadingM style={styles.modalTitle}>Create Escrow Account</HeadingM>

            <Body style={styles.escrowDescription}>
              Initialize your escrow account on Solana to enable offline payments.
              This will create a secure Program Derived Address (PDA) that holds your USDC.
            </Body>

            <View style={styles.escrowInputContainer}>
              <Small style={styles.labelMuted}>Initial deposit amount (USDC)</Small>
              <TextInput
                style={styles.escrowInput}
                value={escrowAmount}
                onChangeText={setEscrowAmount}
                keyboardType="decimal-pad"
                placeholder="10.00"
                placeholderTextColor="rgba(148,163,184,0.5)"
              />
              <Small style={styles.helperText}>
                Available: {walletUsdcBalance.toFixed(2)} USDC
              </Small>
            </View>

            <View style={styles.escrowInfoBox}>
              <Small style={styles.escrowInfoText}>
                ⚠️ This transaction requires ~0.01 SOL for transaction fees and rent.
              </Small>
              <Small style={styles.escrowInfoText}>
                ✅ Your SOL balance: {walletSolBalance.toFixed(3)} SOL
              </Small>
            </View>

            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setShowEscrowModal(false);
                  setEscrowAmount('10');
                }}
                style={{ flex: 1 }}
              />
              <Button
                label="Create Escrow"
                variant="primary"
                onPress={createEscrow}
                style={{ flex: 1 }}
                loading={creatingEscrow}
              />
            </View>
          </Card>
        </View>
      </Modal>

      {
        creatingEscrow && (
          <View style={styles.loadingOverlay}>
            <Card variant="glass" padding="lg" style={styles.loadingCard}>
              <ActivityIndicator size="large" color={palette.accentBlue} />
              <Body style={styles.loadingBody}>Creating escrow account...</Body>
              <Small style={styles.helperText}>This may take a few seconds</Small>
            </Card>
          </View>
        )
      }
    </>
  );
}

const styles = StyleSheet.create({
  textIcon: {
    fontSize: 20,
  },
  heroCard: {
    gap: spacing.sm,
  },
  labelMuted: {
    color: 'rgba(226,232,240,0.72)',
  },
  heroSub: {
    color: 'rgba(148,163,184,0.9)',
  },
  balanceSub: {
    color: 'rgba(148,163,184,0.72)',
    marginTop: 2,
  },
  balanceLabel: {
    color: 'rgba(148,163,184,0.82)',
  },
  balanceValue: {
    color: palette.textPrimary,
    fontWeight: '500',
  },
  helperText: {
    color: 'rgba(148,163,184,0.82)',
  },
  errorCard: {
    marginTop: spacing.md,
  },
  errorCopy: {
    color: palette.textPrimary,
  },
  diagnosticsButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  metricsCard: {
    gap: spacing.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  bundleListContainer: {
    marginTop: spacing.lg,
  },
  diagnosticsCard: {
    gap: spacing.md,
  },
  diagnosticsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  hashLabel: {
    fontSize: 12,
    color: 'rgba(148,163,184,0.82)',
    fontFamily: 'Menlo',
  },
  fraudCard: {
    gap: spacing.md,
  },
  fraudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fraudContent: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
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
  modalTitle: {
    textAlign: 'center',
  },
  escrowModalCard: {
    width: '100%',
    maxWidth: 400,
    gap: spacing.lg,
    padding: spacing.xl,
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
  escrowDescription: {
    color: 'rgba(148,163,184,0.9)',
    textAlign: 'center',
    lineHeight: 20,
  },
  escrowInputContainer: {
    gap: spacing.xs,
  },
  escrowInput: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
    borderRadius: radius.md,
    padding: spacing.md,
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  escrowInfoBox: {
    backgroundColor: 'rgba(79,70,229,0.08)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  escrowInfoText: {
    color: 'rgba(226,232,240,0.82)',
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statusCard: {
    gap: spacing.md,
  },
  statusText: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
});
