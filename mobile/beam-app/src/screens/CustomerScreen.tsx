
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, Modal, RefreshControl, TextInput } from 'react-native';
import { wallet } from '../wallet/WalletManager';
import { createUnsignedBundle, serializeBundle } from '@beam/shared';
import type { OfflineBundle } from '@beam/shared';
import { SettlementService } from '../services/SettlementService';
import { bundleStorage } from '../storage/BundleStorage';
import { PublicKey } from '@solana/web3.js';
import { QRScanner } from '../components/QRScanner';
import { Config } from '../config';
import { BeamProgramClient } from '../solana/BeamProgram';
import { attestationService } from '../services/AttestationService';
import { bleDirect } from '../services/BLEDirectService';
import { autoSettlementService } from '../services/AutoSettlementService';
import { networkService } from '../services/NetworkService';
import { bleConnectionManager } from '../services/BLEConnectionManager';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { PaymentSheet } from '../components/features/PaymentSheet';
import { MeshNetworkStatus } from '../components/MeshNetworkStatus';
import { SecurityStatusCard } from '../components/SecurityStatusCard';
import { TransactionHistory } from '../components/TransactionHistory';
import { PaymentFlowAnimation, type PaymentStage } from '../components/PaymentFlowAnimation';
import { BLEConnectionModal } from '../components/BLEConnectionModal';
import { TransactionSuccessModal } from '../components/TransactionSuccessModal';
import { palette, radius, spacing } from '../design/tokens';
import type { BundleHistoryEntry, FraudRecordEntry } from '../solana/types';
import { Buffer } from 'buffer';
import NetInfo from '@react-native-community/netinfo';

function TextIcon({ label }: { label: string }) {
  return <Small style={styles.textIcon}>{label}</Small>;
}

const settlementService = new SettlementService();

export function CustomerScreen() {
  const [escrowBalance, setEscrowBalance] = useState(0);
  const [walletSolBalance, setWalletSolBalance] = useState(0);
  const [walletUsdcBalance, setWalletUsdcBalance] = useState(0);
  const normalizeBundles = useCallback((bundles: OfflineBundle[]) => {
    const seen = new Map<string, OfflineBundle>();
    bundles.forEach(bundle => {
      const existing = seen.get(bundle.tx_id);
      if (!existing || existing.timestamp < bundle.timestamp) {
        seen.set(bundle.tx_id, bundle);
      }
    });
    return Array.from(seen.values());
  }, []);

  const [pendingBundles, setPendingBundles] = useState<OfflineBundle[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [history, setHistory] = useState<BundleHistoryEntry[]>([]);
  const [fraudRecords, setFraudRecords] = useState<FraudRecordEntry[]>([]);
  const [meshDiag, setMeshDiag] = useState(bleDirect.getDiagnostics());
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [paymentStage, setPaymentStage] = useState<PaymentStage | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paySheetVisible, setPaySheetVisible] = useState(false);
  const [paySheetStage, setPaySheetStage] = useState<'review' | 'submitting' | 'confirming' | 'done' | 'error'>('review');
  const [paySheetProgress, setPaySheetProgress] = useState(0);
  const payConfirmRef = useRef<null | (() => Promise<void>)>(null);

  const [pendingPayInfo, setPendingPayInfo] = useState<{ merchant: string; description: string } | null>(null);
  const meshUnsubscribe = useRef<(() => void) | null>(null);
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowAmount, setEscrowAmount] = useState('10');
  const [creatingEscrow, setCreatingEscrow] = useState(false);
  const [escrowExists, setEscrowExists] = useState(false);
  const [settlementStatus, setSettlementStatus] = useState<string>('');

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
  }>({ visible: false, type: 'online', amount: 0 });



  const loadData = useCallback(async () => {
    console.log('[CustomerScreen] ========== loadData CALLED ==========');
    setRefreshing(true);
    try {
      // Ensure wallet is loaded from secure storage
      const walletPubkey = await wallet.loadWallet();
      console.log('[CustomerScreen] Wallet loaded:', walletPubkey?.toBase58());
      setWalletAddress(walletPubkey?.toBase58() ?? null);

      // Load pending bundles from storage
      const bundles = await bundleStorage.loadBundles();
      console.log('[CustomerScreen] Pending bundles loaded:', bundles.length);
      setPendingBundles(normalizeBundles(bundles));

      // Load nonce from storage
      const nonce = await bundleStorage.loadNonce();
      console.log('[CustomerScreen] Current nonce:', nonce);
      wallet.setNonce(nonce);

      // Check if online
      console.log('[CustomerScreen] Checking online status...');
      const online = await settlementService.isOnline();
      console.log('[CustomerScreen] Online status:', online);
      setIsOnline(online);

      // Get wallet and escrow balances - try even if offline for better UX
      const pubkey = wallet.getPublicKey();
      if (pubkey) {
        try {
          console.log('[CustomerScreen] Fetching balances...');
          // Don't require biometric for read-only balance check
          // Use a temporary connection without signer
          const { connectionService } = require('../services/ConnectionService');
          const connection = connectionService.getConnection();

          // Fetch wallet SOL balance
          try {
            const solBalance = await connection.getBalance(pubkey);
            const solInSol = solBalance / 1_000_000_000; // Convert lamports to SOL
            console.log('[CustomerScreen] ✅ SOL balance:', solInSol);
            setWalletSolBalance(solInSol);
          } catch (err) {
            console.error('[CustomerScreen] Failed to fetch SOL balance:', err);
          }

          // Fetch wallet USDC balance
          try {
            const { getAssociatedTokenAddress } = require('@solana/spl-token');
            const usdcMint = new PublicKey(Config.tokens.usdc.mint);
            const ataAddress = await getAssociatedTokenAddress(usdcMint, pubkey);

            const tokenAccountInfo = await connection.getTokenAccountBalance(ataAddress);
            const usdcAmount = tokenAccountInfo.value.uiAmount || 0;
            console.log('[CustomerScreen] ✅ USDC balance:', usdcAmount);
            setWalletUsdcBalance(usdcAmount);
          } catch (err) {
            console.log('[CustomerScreen] No USDC token account or fetch failed (non-critical):', err);
            setWalletUsdcBalance(0);
          }

          // Try to get escrow balance - handle case where escrow doesn't exist yet
          try {
            console.log('[CustomerScreen] Attempting to fetch escrow balance...');
            const { BeamProgramClient } = require('../solana/BeamProgram');
            // Create read-only client (NO SIGNER - real blockchain queries only)
            const readOnlyClient = new BeamProgramClient(Config.solana.rpcUrl);

            // Check if escrow account exists
            const escrowAccount = await readOnlyClient.getEscrowAccount(pubkey);
            if (escrowAccount) {
              console.log('[CustomerScreen] ✅ Escrow account exists');
              setEscrowExists(true);
              setEscrowBalance(escrowAccount.escrowBalance);
              console.log('[CustomerScreen] ✅ Escrow balance fetched:', escrowAccount.escrowBalance);
            } else {
              console.log('[CustomerScreen] Escrow account does not exist yet');
              setEscrowExists(false);
              setEscrowBalance(0);
            }

            // If we have balance, also try to get history (with auth)
            if (online && escrowAccount && escrowAccount.escrowBalance > 0) {
              try {
                const signer = await wallet.getSigner('View transaction history');
                if (signer) {
                  settlementService.initializeClient(signer);
                  const registry = await settlementService.getNonceRegistrySnapshot(pubkey, signer);
                  if (registry) {
                    const recentHistory = [...registry.bundleHistory].slice(-5).reverse();
                    const recentFraud = [...registry.fraudRecords].slice(-3).reverse();
                    setHistory(recentHistory);
                    setFraudRecords(recentFraud);
                    console.log('[CustomerScreen] History loaded:', recentHistory.length, 'entries');
                  }
                }
              } catch (histErr) {
                console.log('[CustomerScreen] Could not load history (non-critical):', histErr);
              }
            }
          } catch (escrowErr) {
            console.log('[CustomerScreen] Could not fetch escrow balance:', escrowErr);
            // This is expected if the escrow account doesn't exist yet
            const errorMsg = escrowErr instanceof Error ? escrowErr.message : String(escrowErr);
            if (errorMsg.includes('Account does not exist') || errorMsg.includes('could not find account')) {
              console.log('[CustomerScreen] Escrow account not initialized yet - showing 0 balance');
              setEscrowExists(false);
              setEscrowBalance(0);
            } else if (online) {
              // Only show error if we're online and it's not an "account doesn't exist" error
              console.error('[CustomerScreen] ❌ Unexpected escrow fetch error:', escrowErr);
              Alert.alert(
                'Balance Load Failed',
                'Could not fetch escrow balance. The RPC endpoint may be unavailable.\n\nYou can still create offline payments.',
                [{ text: 'OK' }]
              );
              setEscrowExists(false);
              setEscrowBalance(0);
            } else {
              // Offline - just set to 0
              setEscrowExists(false);
              setEscrowBalance(0);
            }
          }
        } catch (err) {
          console.error('[CustomerScreen] ❌ Wallet/connection error:', err);
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
      console.log('[CustomerScreen] ========== loadData COMPLETED ==========');
    }
  }, [normalizeBundles]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = bleDirect.addDiagnosticsListener(diag => setMeshDiag(diag));
    return unsubscribe;
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

  // Setup BLE ACK listener for connection status
  useEffect(() => {
    const unsubscribe = bleDirect.addAckListener(event => {
      console.log('[CustomerScreen] BLE ACK event:', event);
      switch (event.type) {
        case 'ack':
          setSettlementStatus(`✅ Merchant confirmed payment ${event.bundleId.slice(0, 8)}...`);
          Alert.alert(
            'Merchant Confirmed! ✅',
            `Merchant has confirmed receipt of payment ${event.bundleId.slice(0, 8)}...\n\nPayment will settle automatically when online.`,
            [{ text: 'OK' }]
          );
          break;
        case 'nack':
          setSettlementStatus(`❌ Merchant rejected payment: ${event.reason}`);
          Alert.alert(
            'Payment Rejected',
            `Merchant rejected the payment: ${event.reason || 'Unknown reason'}`,
            [{ text: 'OK' }]
          );
          break;
        case 'timeout':
          setSettlementStatus(`⏱️ No response from merchant for ${event.bundleId.slice(0, 8)}...`);
          break;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    meshUnsubscribe.current?.();
    meshUnsubscribe.current = null;

    if (!walletAddress) {
      return () => { };
    }

    let cancelled = false;

    const subscribeToMesh = async () => {
      try {
        await bleDirect.ensureActive(Config.ble.serviceUUID);
        const unsubscribe = await bleDirect.subscribe(async message => {
          if (message.bundle.payer_pubkey !== walletAddress) {
            return;
          }

          if (!message.bundle.merchant_signature || message.bundle.merchant_signature.length === 0) {
            return;
          }

          let signatureRecorded = false;
          const updatedBundle = await bundleStorage.updateBundle(message.bundle.tx_id, existing => {
            if (existing.merchant_signature && existing.merchant_signature.length > 0) {
              return existing;
            }
            signatureRecorded = true;
            return {
              ...existing,
              merchant_signature: message.bundle.merchant_signature,
            };
          });

          if (!updatedBundle || !signatureRecorded) {
            return;
          }

          const metadata = {
            amount: updatedBundle.token.amount,
            currency: updatedBundle.token.symbol,
            merchantPubkey: updatedBundle.merchant_pubkey,
            payerPubkey: updatedBundle.payer_pubkey,
            nonce: updatedBundle.nonce,
            createdAt: updatedBundle.timestamp,
          };

          try {
            await attestationService.storeBundle(updatedBundle, metadata, {
              payerAttestation: message.payerAttestation,
              merchantAttestation: message.merchantAttestation,
              selfRole: 'payer',
            });
          } catch (err) {
            if (__DEV__) {
              console.warn('Failed to persist merchant attestation', err);
            }
          }

          const refreshed = await bundleStorage.loadBundles();
          setPendingBundles(normalizeBundles(refreshed));

          Alert.alert(
            'Merchant Confirmed',
            `Bundle ${updatedBundle.tx_id.slice(0, 8)}… countersigned by merchant. Ready for settlement.`
          );
        }, Config.ble.serviceUUID);

        if (!cancelled) {
          meshUnsubscribe.current = unsubscribe;
        } else {
          unsubscribe();
        }
      } catch (err) {
        if (__DEV__) {
          console.error('Failed to subscribe to mesh bundles', err);
        }
      }
    };

    void subscribeToMesh();

    return () => {
      cancelled = true;
      meshUnsubscribe.current?.();
      meshUnsubscribe.current = null;
    };
  }, [walletAddress, normalizeBundles]);

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

      // Show confirmation sheet BEFORE creating payment
      const desc = paymentRequest.description || 'Payment';
      const usdcAmount = amount / 1_000_000;
      setPendingPayInfo({ merchant, description: desc });
      setPaymentAmount(usdcAmount);
      setPaySheetStage('review');
      setPaySheetProgress(0);
      payConfirmRef.current = async () => {
        try {
          setPaySheetStage('submitting');
          setPaySheetProgress(0.35);
          await createPayment(merchant, usdcAmount, desc);
          setPaySheetStage('confirming');
          setPaySheetProgress(0.85);
          setPaySheetStage('done');
          setPaySheetProgress(1);
          // Success - don't show error alert, createPayment handles success message
        } catch (err) {
          setPaySheetStage('error');
          const msg = err instanceof Error ? err.message : String(err);
          // Only show error if it's a real failure (not successful offline creation)
          if (!msg.includes('Payment created') && !msg.includes('stored locally')) {
            Alert.alert('Payment Failed', msg);
          }
        } finally {
          setPaySheetVisible(false);
        }
      };
      setPaySheetVisible(true);
    } catch (err) {
      console.error('[CustomerScreen] ❌ Error processing QR code:', err);
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to process QR code:\n${message}`);
    } finally {
      setLoading(false);
      console.log('[CustomerScreen] ========== handleQRScan COMPLETED ==========');
    }
  };

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
    setPaymentAmount(amount);

    try {
      // ===== NEW: PROPER ONLINE/OFFLINE ROUTING =====
      if (hasInternet) {
        // ONLINE: Direct on-chain settlement (skip BLE)
        console.log('[CustomerScreen] 🌐 Using ONLINE flow - direct settlement');
        await createOnlinePayment(merchantPubkey, amountInSmallestUnit, description);
      } else {
        // OFFLINE: BLE payment with connection confirmation
        console.log('[CustomerScreen] 📡 Using OFFLINE BLE flow');
        await createOfflinePayment(merchantPubkey, amountInSmallestUnit, description);
      }
    } catch (err) {
      console.error('[CustomerScreen] ========== createPayment FAILED ==========');
      console.error('[CustomerScreen] Error:', err);
      throw err;
    }
  };

  const createOnlinePayment = async (
    merchantPubkey: string,
    amountInSmallestUnit: number,
    description: string
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
    description: string
  ) => {
    console.log('[CustomerScreen] 📡 OFFLINE PAYMENT FLOW STARTED');

    const payerPubkey = wallet.getPublicKey();
    if (!payerPubkey) throw new Error('Wallet not loaded');

    // NEW: Set BLE connection manager role
    bleConnectionManager.setRole('customer');

    try {
      // NEW: Step 1 - Wait for BLE connection
      console.log('[CustomerScreen] Step 1: Waiting for BLE connection...');
      setBleConnectionModal({ visible: true, status: 'searching' });

      // Start BLE scanning
      await bleDirect.startBLENode(Config.ble.serviceUUID);

      // Wait for connection with 30 second timeout
      const isConnected = await bleConnectionManager.waitForConnection(30000);

      if (!isConnected) {
        console.error('[CustomerScreen] ❌ BLE connection timeout');
        setBleConnectionModal({ visible: true, status: 'failed' });

        // Wait 2 seconds to show failure message
        await new Promise(resolve => setTimeout(resolve, 2000));
        setBleConnectionModal({ visible: false, status: 'searching' });

        throw new Error('Could not connect to merchant via Bluetooth. Please ensure the merchant device is nearby with Bluetooth enabled.');
      }

      // Show connection success
      const connState = bleConnectionManager.getConnectionState();
      console.log('[CustomerScreen] ✅ BLE connected to:', connState.peerName);
      setBleConnectionModal({
        visible: true,
        status: 'connected',
        peerName: connState.peerName || 'Merchant'
      });

      // Wait for user to confirm connection
      // REMOVED: Auto-close timeout - user must tap "Continue" button
      // The modal's "onConfirm" callback will close it and continue payment

      // NEW: Step 2 - Check escrow balance before creating bundle
      console.log('[CustomerScreen] Step 2: Checking escrow balance...');
      if (escrowBalance < amountInSmallestUnit / 1_000_000) {
        throw new Error(`Insufficient escrow balance. You have ${escrowBalance.toFixed(2)} USDC but need ${(amountInSmallestUnit / 1_000_000).toFixed(2)} USDC.`);
      }

      // Stage 1: Creating bundle
      setPaymentStage('creating');
      setPaymentMessage('Creating offline payment bundle...');

      // Get escrow PDA
      const escrowPDA = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), payerPubkey.toBuffer()],
        new PublicKey(Config.program.id)
      )[0].toBase58();

      const tokenMint = Config.tokens.usdc.mint;
      const tokenDecimals = Config.tokens.usdc.decimals;

      // Get next nonce
      const nonce = await bundleStorage.incrementNonce();
      wallet.setNonce(nonce);

      // Create offline bundle
      const unsignedBundle = createUnsignedBundle(
        escrowPDA,
        payerPubkey.toBase58(),
        merchantPubkey,
        amountInSmallestUnit,
        tokenMint,
        tokenDecimals,
        nonce
      );

      // Stage 2: Signing
      setPaymentStage('signing');
      setPaymentMessage('Signing payment with your key...');

      const serialized = serializeBundle(unsignedBundle);
      const payerSignature = await attestationService.signPayload(serialized, 'Authorize offline payment');
      const bundle = {
        ...unsignedBundle,
        payer_signature: payerSignature,
      };

      // Store bundle locally before sending
      await bundleStorage.saveBundle(bundle);

      // Stage 3: BLE Broadcasting
      setPaymentStage('broadcasting');
      setPaymentMessage('Sending payment via Bluetooth...');

      // Send via BLE immediately (device is already connected)
      const result = await bleDirect.broadcastBundle(
        bundle,
        Config.ble.serviceUUID,
        undefined, // No attestation for offline
        undefined
      );

      if (!result.success) {
        console.error('[CustomerScreen] ❌ BLE broadcast failed');
        throw new Error('Failed to send payment via Bluetooth. The merchant may have disconnected.');
      }

      console.log('[CustomerScreen] ✅ Payment sent via BLE successfully');

      // Stage 4: Success
      setPaymentStage('success');
      setPaymentMessage('Payment sent successfully!');

      // NEW: Update local escrow balance immediately (optimistic update)
      const newEscrowBalance = escrowBalance - (amountInSmallestUnit / 1_000_000);
      setEscrowBalance(newEscrowBalance);
      console.log('[CustomerScreen] ✅ Escrow balance updated locally:', newEscrowBalance);

      // NEW: Show transaction success modal
      setTxSuccessModal({
        visible: true,
        type: 'offline',
        amount: amountInSmallestUnit / 1_000_000,
        bundleId: bundle.tx_id,
      });

      // Update UI
      const bundles = await bundleStorage.loadBundles();
      setPendingBundles(normalizeBundles(bundles));

    } catch (err) {
      console.error('[CustomerScreen] ❌ Offline payment failed:', err);
      setPaymentStage('error');
      setPaymentMessage('Payment failed');

      // Close BLE connection modal if still open
      setBleConnectionModal({ visible: false, status: 'searching' });

      throw err;
    } finally {
      // Clear animation
      setTimeout(() => {
        setPaymentStage(null);
        setPaymentMessage('');
      }, 3000);
    }
  };

  const initiatePayment = async () => {
    Alert.alert(
      'Create Payment',
      'Please use the QR scanner to scan a merchant payment request.\n\nMerchants can generate payment QR codes from their dashboard.',
      [{ text: 'OK' }]
    );
  };


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

    try {
      console.log('[CustomerScreen] Creating escrow with amount:', amount, 'USDC');

      // Convert USDC to smallest unit (6 decimals)
      const amountInSmallestUnit = Math.floor(amount * 1_000_000);
      console.log('[CustomerScreen] Amount in smallest unit:', amountInSmallestUnit);

      // Initialize BeamProgramClient with real signer
      const { BeamProgramClient } = require('../solana/BeamProgram');
      const beamClient = new BeamProgramClient(Config.solana.rpcUrl, signer);

      console.log('[CustomerScreen] Initializing escrow account...');
      const txSignature = await beamClient.initializeEscrow(amountInSmallestUnit);
      console.log('[CustomerScreen] ✅ Escrow created! Transaction:', txSignature);

      // Wait for confirmation
      console.log('[CustomerScreen] Waiting for transaction confirmation...');
      const connection = beamClient.getConnection();
      await connection.confirmTransaction(txSignature, Config.solana.commitment);
      console.log('[CustomerScreen] ✅ Transaction confirmed!');

      // Update UI
      await loadData();

      Alert.alert(
        'Escrow Created Successfully!',
        `Your escrow account has been created and funded with ${amount.toFixed(2)} USDC.\n\nTransaction: ${txSignature.slice(0, 8)}...${txSignature.slice(-8)}\n\nYou can now create offline payments!`,
        [{ text: 'OK' }]
      );

    } catch (err) {
      console.error('[CustomerScreen] ❌ Error creating escrow:', err);
      const message = err instanceof Error ? err.message : String(err);

      // Provide helpful error messages
      let errorTitle = 'Escrow Creation Failed';
      let errorMessage = message;

      if (message.includes('insufficient funds')) {
        errorTitle = 'Insufficient Funds';
        errorMessage = 'You do not have enough SOL to pay for the transaction fee.\n\nPlease ensure you have at least 0.01 SOL in your wallet.';
      } else if (message.includes('already in use')) {
        errorTitle = 'Escrow Already Exists';
        errorMessage = 'Your escrow account already exists. Try refreshing the page.';
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

  const totalPending = pendingBundles.reduce((sum, b) => sum + b.token.amount / 1_000_000, 0);
  const meshQueueStatus = meshDiag.queueLength > 0 ? 'pending' : meshDiag.started ? 'online' : 'offline';
  const meshQueueLabel = meshDiag.queueLength > 0
    ? `${meshDiag.queueLength} queued`
    : meshDiag.started
      ? 'Mesh active'
      : 'Mesh disabled';
  const formatTimestamp = (value: number | null) => (value ? new Date(value).toLocaleTimeString() : '—');
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
                  <Small style={styles.labelMuted}>Escrow Balance</Small>
                  <HeadingL style={{ marginTop: spacing.xs }}>
                    ${(escrowBalance / 1_000_000).toFixed(2)} USDC
                  </HeadingL>
                  <Body style={styles.heroSub}>
                    {escrowBalance > 0
                      ? (isOnline ? 'Live from chain' : 'Last known balance')
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
          title="Quick actions"
          description="Scan merchant QR codes to create payments that settle automatically."
        >
          <Card style={styles.actionsCard}>
            <View style={styles.actionsRow}>
              <Button
                label="Scan merchant QR"
                icon={<TextIcon label="📷" />}
                onPress={() => setShowScanner(true)}
                loading={loading}
              />
              <Button
                label="Create payment"
                icon={<TextIcon label="💰" />}
                variant="secondary"
                onPress={initiatePayment}
                disabled={loading}
              />
            </View>
            <Small style={styles.helperText}>
              Payments work offline and settle automatically when online.
            </Small>
          </Card>
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
        <MeshNetworkStatus />
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

            {pendingBundles.length > 0 ? (
              <View style={styles.bundleList}>
                {pendingBundles.slice(0, 4).map((bundle, index) => (
                  <View key={`${bundle.tx_id}-${index}`} style={styles.bundleRow}>
                    <View style={styles.bundleAvatar}>
                      <Small style={styles.bundleEmoji}>💳</Small>
                    </View>
                    <View style={styles.bundleContent}>
                      <HeadingM>{`$${(bundle.token.amount / 1_000_000).toFixed(2)} USDC`}</HeadingM>
                      <Body numberOfLines={1} style={styles.bundleCopy}>
                        {`Merchant: ${bundle.merchant_pubkey.slice(0, 8)}…${bundle.merchant_pubkey.slice(-4)} · Nonce ${bundle.nonce}`}
                      </Body>
                    </View>
                  </View>
                ))}
                {pendingBundles.length > 4 ? (
                  <Small style={styles.moreLabel}>
                    {`+${pendingBundles.length - 4} additional bundle${pendingBundles.length - 4 === 1 ? '' : 's'}`}
                  </Small>
                ) : null}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <HeadingM>No pending payments</HeadingM>
                <Body style={styles.helperText}>Create a payment and it will appear here until settled on Solana.</Body>
              </View>
            )}
          </Card>
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
                icon={meshDiag.queueLength > 0 ? '🔁' : meshDiag.started ? '📡' : '🛑'}
              />
              <StatusBadge status="online" label="Secure enclave" icon="🔐" />
            </View>
            <Body style={styles.helperText}>
              Beam automatically retries mesh broadcasts when online. Pull-to-refresh to sync latest escrow balance and
              verifier reachability.
            </Body>
            <Body style={styles.helperText}>
              {`Last mesh success: ${formatTimestamp(meshDiag.lastSuccessAt)} · Last receive: ${formatTimestamp(meshDiag.lastReceiveAt)}`}
              {meshDiag.lastError ? ` · Last error: ${meshDiag.lastError}` : ''}
            </Body>
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


      {/* Payment confirmation sheet */}
      <PaymentSheet
        visible={paySheetVisible}
        title="Confirm Payment"
        subtitle={pendingPayInfo ? `Merchant ${pendingPayInfo.merchant.slice(0, 8)}…${pendingPayInfo.merchant.slice(-6)}` : undefined}
        amountLabel={`$${paymentAmount.toFixed(2)} USDC`}
        onCancel={() => setPaySheetVisible(false)}
        onConfirm={() => payConfirmRef.current && payConfirmRef.current()}
        stage={paySheetStage}
        progress={paySheetProgress}
        footnote={bleDirect.getDiagnostics().started ? 'Bluetooth: On — will deliver automatically' : 'Bluetooth: Off — use Show QR if needed'}
      />

      {/* NEW: BLE Connection Modal */}
      <BLEConnectionModal
        visible={bleConnectionModal.visible}
        status={bleConnectionModal.status}
        peerName={bleConnectionModal.peerName}
        role="customer"
        onConfirm={() => setBleConnectionModal({ ...bleConnectionModal, visible: false })}
        onCancel={() => {
          setBleConnectionModal({ visible: false, status: 'searching' });
          setPaySheetVisible(false);
        }}
      />

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
  actionsCard: {
    gap: spacing.md,
  },
  actionsRow: {
    flexDirection: 'column',
    gap: spacing.sm,
  },
  helperText: {
    color: 'rgba(148,163,184,0.82)',
  },
  metricsCard: {
    gap: spacing.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  bundleList: {
    gap: spacing.md,
  },
  bundleRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  bundleAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(88,28,135,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bundleEmoji: {
    fontSize: 18,
  },
  bundleCopy: {
    color: palette.textSecondary,
  },
  bundleContent: {
    flex: 1,
    gap: spacing.xs,
  },
  moreLabel: {
    alignSelf: 'flex-end',
    color: 'rgba(148,163,184,0.82)',
  },
  emptyState: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: 'rgba(79,70,229,0.08)',
    gap: spacing.md,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
  emptyStateButton: {
    marginTop: spacing.sm,
    minHeight: 48,
  },
  diagnosticsCard: {
    gap: spacing.md,
  },
  diagnosticsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  historyCard: {
    gap: spacing.md,
  },
  historyList: {
    gap: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  hashLabel: {
    fontSize: 12,
    color: 'rgba(148,163,184,0.82)',
    fontFamily: 'Menlo',
  },
  historyContent: {
    flex: 1,
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
