import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, ActivityIndicator, RefreshControl, TextInput, Switch, View, StyleSheet, Modal, PermissionsAndroid, Platform, Image } from 'react-native';
import type { BeamQRPaymentRequest, OfflineBundle, AttestationEnvelope } from '@beam/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCodeGenerator from '../native/QRCodeGenerator';
import bs58 from 'bs58';
import { wallet } from '../wallet/WalletManager';
import { serializeBundle, verifyCompletedBundle } from '@beam/shared';
import { SettlementService } from '../services/SettlementService';
import { bleDirect, type BLEBundleMessage, type BLEDiagnostics } from '../services/BLEDirectService';
import { Config } from '../config';
import { attestationService } from '../services/AttestationService';
import { bundleTransactionManager, BundleState } from '../storage/BundleTransactionManager';
import { autoSettlementService } from '../services/AutoSettlementService';
import { networkService } from '../services/NetworkService';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { PaymentSheet } from '../components/features/PaymentSheet';
import { PeerDiscoveryView } from '../components/PeerDiscoveryView';
import { palette, radius, spacing } from '../design/tokens';
import { QRScanner } from '../components/QRScanner';
import { decodeOfflineBundle } from '../storage/BundleStorage';
import { Buffer } from 'buffer';

const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
const settlementService = new SettlementService();

function EmojiIcon({ symbol }: { symbol: string }) {
  return <Small style={styles.emojiIcon}>{symbol}</Small>;
}

export function MerchantScreen() {
  const [amount, setAmount] = useState('10.00');
  const [confirmSheet, setConfirmSheet] = useState(false);
  const [sheetStage, setSheetStage] = useState<'review'|'submitting'|'confirming'|'done'|'error'>('review');
  const [sheetProgress, setSheetProgress] = useState(0);
  const confirmRef = useRef<null | (() => Promise<void>)>(null);
  const [qrData, setQRData] = useState<string | null>(null);
  const [qrImageBase64, setQRImageBase64] = useState<string | null>(null);
  const [meshEnabled, setMeshEnabled] = useState(false);
  const [receivedPayments, setReceivedPayments] = useState<OfflineBundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [merchantAddress, setMerchantAddress] = useState<string | null>(null);
  const [meshDiag, setMeshDiag] = useState<BLEDiagnostics>(bleDirect.getDiagnostics());
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [showBundleScanner, setShowBundleScanner] = useState(false);
  const [isOnline, setIsOnline] = useState(networkService.getIsOnline());
  const [settlementStatus, setSettlementStatus] = useState<string>('');
  const meshUnsubscribe = useRef<(() => void) | null>(null);

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
      const json = await AsyncStorage.getItem(MERCHANT_RECEIVED_KEY);
      if (json) {
        const payments: OfflineBundle[] = JSON.parse(json);
        setReceivedPayments(payments);
      }
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to load received payments:', err);
      }
    }
  }, []);

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
    const unsubscribe = bleDirect.addDiagnosticsListener(diag => {
      setMeshDiag(diag);
      setMeshEnabled(diag.started);
    });
    return unsubscribe;
  }, []);

  // Setup network status listener
  useEffect(() => {
    const unsubscribe = networkService.addOnlineListener(online => {
      console.log('[MerchantScreen] Network status changed:', online);
      setIsOnline(online);
      if (online) {
        setSettlementStatus('🌐 Online - Auto-settling...');
      } else {
        setSettlementStatus('📡 Offline - Payments stored locally');
      }
    });
    return unsubscribe;
  }, []);

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
          Alert.alert(
            'Payment Settled! ✅',
            `Bundle ${event.bundleId.slice(0, 8)}... has been settled on Solana.\n\n${event.message}`,
            [{ text: 'OK', onPress: () => loadReceivedPayments() }]
          );
          break;
        case 'settlement_error':
          setSettlementStatus(`❌ Settlement failed: ${event.error}`);
          break;
      }
    });
    return unsubscribe;
  }, [loadReceivedPayments]);

  useEffect(() => {
    return () => {
      meshUnsubscribe.current?.();
      meshUnsubscribe.current = null;
      if (meshEnabled) {
        bleDirect.stopBLENode().catch(err => {
          if (__DEV__) {
            console.warn('Failed to stop mesh network on unmount', err);
          }
        });
      }
    };
  }, [meshEnabled]);

  const saveReceivedPayments = useCallback(async (payments: OfflineBundle[]) => {
    try {
      await AsyncStorage.setItem(MERCHANT_RECEIVED_KEY, JSON.stringify(payments));
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to save received payments:', err);
      }
    }
  }, []);

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

        const unsigned = {
          tx_id: bundle.tx_id,
          escrow_pda: bundle.escrow_pda,
          token: bundle.token,
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

        // Update UI with merchant storage
        const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
        const json = await AsyncStorage.getItem(MERCHANT_RECEIVED_KEY);
        const payments: OfflineBundle[] = json ? JSON.parse(json) : [];
        setReceivedPayments(payments);

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
    [decodeAttestationFromPayload]
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

      // Ensure BLE permissions then enable advertising/scanning for auto-receive
      const ensureBlePermissions = async (): Promise<boolean> => {
        if (Platform.OS !== 'android') return true;
        try {
          if (Platform.Version >= 31) {
            const granted = await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            ]);
            const ok =
              granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
              granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
              granted['android.permission.BLUETOOTH_ADVERTISE'] === PermissionsAndroid.RESULTS.GRANTED &&
              granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
            return ok;
          } else {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            );
            return granted === PermissionsAndroid.RESULTS.GRANTED;
          }
        } catch (e) {
          if (__DEV__) console.warn('[MerchantScreen] BLE permission request failed', e);
          return false;
        }
      };

      try {
        const ok = await ensureBlePermissions();
        if (ok) {
          await bleDirect.ensureActive(Config.ble.serviceUUID);
        }
        if (!meshUnsubscribe.current) {
          const unsub = await bleDirect.subscribe(handleIncomingBundle, Config.ble.serviceUUID);
          meshUnsubscribe.current = unsub;
        }
      } catch (e) {
        console.warn('[MerchantScreen] BLE ensureActive failed', e);
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

  const handleIncomingBundle = useCallback(
    async (message: BLEBundleMessage) => {
      const { bundle, payerAttestation } = message;
      if (!payerAttestation) {
        if (__DEV__) {
          console.warn('Received bundle without payer attestation');
        }
        return;
      }

      const merchantPubkey = await wallet.loadWallet();
      if (!merchantPubkey) {
        return;
      }

      if (bundle.merchant_pubkey !== merchantPubkey.toBase58()) {
        return;
      }

      if (payerAttestation.bundleId !== bundle.tx_id) {
        if (__DEV__) {
          console.warn('Payer attestation bundle mismatch', bundle.tx_id);
        }
        return;
      }

      try {
        const payerPubkey = bs58.decode(bundle.payer_pubkey);
        const merchantPubkeyBytes = bs58.decode(bundle.merchant_pubkey);
        const verification = verifyCompletedBundle(bundle, payerPubkey, merchantPubkeyBytes);
        if (!verification.payerValid) {
          if (__DEV__) {
            console.warn('Received mesh bundle with invalid payer signature', bundle.tx_id);
          }
          return;
        }

        const unsigned = {
          tx_id: bundle.tx_id,
          escrow_pda: bundle.escrow_pda,
          token: bundle.token,
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
        let transaction;
        try {
          transaction = await bundleTransactionManager.storeReceivedBundle({
            bundle: signedBundle,
            metadata,
            payerAttestation,
          });

          if (__DEV__) {
            console.log(`Merchant receipt stored via mesh with transaction state: ${transaction.state}`);
          }
        } catch (err) {
          // Bundle storage failed - transaction was rolled back
          if (__DEV__) {
            console.error('Failed to store merchant receipt from mesh:', err);
          }
          return;
        }

        // Update UI
        const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
        const json = await AsyncStorage.getItem(MERCHANT_RECEIVED_KEY);
        const payments: OfflineBundle[] = json ? JSON.parse(json) : [];
        setReceivedPayments(payments);

        // Queue for mesh broadcast (best effort)
        try {
          await bleDirect.queueBundle(
            signedBundle,
            Config.ble.serviceUUID,
            payerAttestation,
            transaction.merchantAttestation
          );

          // Update transaction state to queued
          await bundleTransactionManager.updateBundleState(bundle.tx_id, BundleState.QUEUED);
        } catch (err) {
          if (__DEV__) {
            console.error('Failed to broadcast signed bundle', err);
          }
        }

        // Reload UI to show new payment
        await loadReceivedPayments();

        // Trigger auto-settlement if online
        if (isOnline) {
          console.log('[MerchantScreen] Triggering immediate auto-settlement for received bundle:', signedBundle.tx_id);
          autoSettlementService.triggerSettlement().catch(err => {
            console.error('[MerchantScreen] Auto-settlement trigger failed:', err);
          });
        }

        // Show success notification with auto-settlement info
        Alert.alert(
          '✅ Payment Received via BLE!',
          `Amount: $${(signedBundle.token.amount / 1_000_000).toFixed(2)} USDC\nFrom: ${signedBundle.payer_pubkey.slice(0, 8)}...${signedBundle.payer_pubkey.slice(-4)}\n\n📱 Stored locally\n${isOnline ? '🌐 Auto-settling on Solana now...' : '📡 Offline - Will auto-settle when online'}`,
          [{ text: 'OK' }]
        );
      } catch (err) {
        if (__DEV__) {
          console.error('Failed to process mesh bundle', err);
        }
      }
    },
    []
  );

  const toggleMesh = async () => {
    if (!meshEnabled) {
      try {
        setLoading(true);

        // Request Bluetooth permissions on Android 12+ (API 31+)
        if (Platform.OS === 'android' && Platform.Version >= 31) {
          try {
            const permissions = [
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            ];

            const granted = await PermissionsAndroid.requestMultiple(permissions);

            // Check if all permissions were granted
            const allGranted = permissions.every(
              permission => granted[permission] === PermissionsAndroid.RESULTS.GRANTED
            );

            if (!allGranted) {
              const deniedPerms = permissions.filter(
                p => granted[p] !== PermissionsAndroid.RESULTS.GRANTED
              ).map(p => p.split('.').pop()).join(', ');

              Alert.alert(
                'Permission Denied',
                `Bluetooth permissions (${deniedPerms}) are required for mesh payments. Please enable them in Settings.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => {
                    Alert.alert('Info', 'Go to Settings → Apps → Beam → Permissions → Nearby devices');
                  }},
                ]
              );
              return;
            }
          } catch (err) {
            console.error('[MerchantScreen] Permission request error:', err);
            Alert.alert('Error', 'Failed to request Bluetooth permissions');
            return;
          }
        }

        const merchantPubkey = await wallet.loadWallet();
        if (!merchantPubkey) {
          Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
          return;
        }

        await bleDirect.ensureActive(Config.ble.serviceUUID);
        const unsubscribe = await bleDirect.subscribe(handleIncomingBundle, Config.ble.serviceUUID);
        meshUnsubscribe.current = unsubscribe;
        setMeshEnabled(true);
        Alert.alert('Mesh Enabled', 'Your device is now discoverable for offline payments via Bluetooth mesh.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert('Mesh Error', message);
      } finally {
        setLoading(false);
      }
    } else {
      meshUnsubscribe.current?.();
      meshUnsubscribe.current = null;
      await bleDirect.stopBLENode();
      setMeshEnabled(false);
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
      '📡 STEP 3: Automatic delivery via BLE mesh\n' +
      '   • If mesh is ON: Payment broadcasts automatically\n' +
      '   • If mesh is OFF: Customer shows bundle QR\n\n' +
      '✅ STEP 4: You receive and sign the payment\n' +
      '   • Auto-received via mesh, OR\n' +
      '   • Scan customer\'s bundle QR manually\n\n' +
      '💰 STEP 5: Settle on-chain when internet available\n\n' +
      'TIP: Enable mesh on BOTH devices for automatic payments!'
    );
  };

  const settleMerchantPayments = async () => {
    if (receivedPayments.length === 0) {
      Alert.alert('No Payments', 'You have no received payments to settle.');
      return;
    }

    const signer = await wallet.getSigner('Settle merchant payments');
    if (!signer) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    const online = await settlementService.isOnline();
    if (!online) {
      Alert.alert('Offline', 'Cannot settle payments while offline. Please connect to internet.');
      return;
    }

    Alert.alert(
      'Settle Payments',
      `Do you want to settle ${receivedPayments.length} payment(s) on Solana?\n\nTotal: $${totalReceived.toFixed(2)} USDC`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Settle',
          onPress: async () => {
            setLoading(true);
            try {
              settlementService.initializeClient(signer);

              const attestedBundles = await attestationService.loadBundles();
              const bundlesToSettle = attestedBundles.filter(attested =>
                receivedPayments.some(payment => payment.tx_id === attested.bundle.tx_id)
              );

              const results = await settlementService.settleMerchantBundles(signer, bundlesToSettle);

              // Update transaction states for successful settlements
              await Promise.all(
                results.success.map(async result => {
                  try {
                    await bundleTransactionManager.updateBundleState(result.bundleId, BundleState.SETTLED);
                    await bundleTransactionManager.deleteMerchantReceipt(result.bundleId);
                  } catch (err) {
                    if (__DEV__) {
                      console.warn(`Failed to update transaction state for ${result.bundleId}:`, err);
                    }
                  }
                })
              );

              // Update transaction states for failed settlements
              await Promise.all(
                results.failed.map(async bundleId => {
                  try {
                    await bundleTransactionManager.updateBundleState(bundleId, BundleState.FAILED, {
                      error: 'Settlement failed',
                    });
                  } catch (err) {
                    if (__DEV__) {
                      console.warn(`Failed to update transaction state for ${bundleId}:`, err);
                    }
                  }
                })
              );

              // Update UI
              const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
              const json = await AsyncStorage.getItem(MERCHANT_RECEIVED_KEY);
              const payments: OfflineBundle[] = json ? JSON.parse(json) : [];
              setReceivedPayments(payments);

              Alert.alert(
                'Settlement Complete',
                `Success: ${results.success.length}\nFailed: ${results.failed.length}`
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Settlement Error', message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const reportConflict = async (payment: OfflineBundle) => {
    setDisputingId(payment.tx_id);
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
    } finally {
      setDisputingId(null);
    }
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadReceivedPayments();
    setRefreshing(false);
  }, [loadReceivedPayments]);

  const totalReceived = receivedPayments.reduce((sum, p) => sum + p.token.amount / 1_000_000, 0);

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accentBlue} />
  );

  const meshBadge = (
    <StatusBadge
      status={isOnline ? 'online' : meshDiag.started ? 'pending' : 'offline'}
      label={isOnline ? (settlementStatus || 'Online - Auto-settling') : meshDiag.started ? 'BLE Active - Offline' : 'Offline'}
      icon={isOnline ? '🌐' : meshDiag.started ? '📡' : '📡'}
    />
  );

  const hero = (
    <Hero
      chip={meshBadge}
      title="Merchant"
      subtitle={
        isOnline
          ? 'Online - Accepting payments via BLE. Auto-settling on Solana.'
          : meshDiag.started
          ? 'Offline - Accepting payments via BLE. Will auto-settle when online.'
          : 'Generate QR to accept offline payments. BLE activates automatically.'
      }
      right={
        <Card variant="glass" padding="lg" style={styles.heroCard}>
          <Small style={styles.labelMuted}>Total received</Small>
          <HeadingL>${totalReceived.toFixed(2)}</HeadingL>
          <Body style={styles.heroSub}>
            {meshDiag.queueLength > 0
              ? `${meshDiag.queueLength} bundle${meshDiag.queueLength === 1 ? '' : 's'} queued`
              : 'Across offline receipts'}
          </Body>
        </Card>
      }
    />
  );

  const receiptsSection = (
    <Section
      title="Offline receipts"
      description={isOnline ? "Payments auto-settle when online. No manual action required." : "Payments stored locally. Will auto-settle when you come online."}
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

        {receivedPayments.length > 0 ? (
          <View style={styles.bundleList}>
            {receivedPayments.slice(0, 5).map(payment => (
              <View key={payment.tx_id} style={styles.bundleRow}>
                <View style={styles.bundleAvatar}>
                  <Small style={styles.bundleEmoji}>✅</Small>
                </View>
                <View style={styles.bundleContent}>
                  <HeadingM>{`$${(payment.token.amount / 1_000_000).toFixed(2)} USDC`}</HeadingM>
                  <Body style={styles.bundleCopy}>
                    {`Nonce ${payment.nonce} · ${new Date(payment.timestamp).toLocaleTimeString()}`}
                  </Body>
                </View>
                <Button
                  label={disputingId === payment.tx_id ? 'Reporting…' : 'Report issue'}
                  variant="ghost"
                  loading={disputingId === payment.tx_id}
                  onPress={() => reportConflict(payment)}
                  style={styles.disputeButton}
                />
              </View>
            ))}
            {receivedPayments.length > 5 ? (
              <Small style={styles.moreLabel}>
                {`+${receivedPayments.length - 5} additional receipt${receivedPayments.length - 5 === 1 ? '' : 's'}`}
              </Small>
            ) : null}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <HeadingM>No receipts yet</HeadingM>
            <Body style={styles.helperText}>Received payments appear here with attestation details.</Body>
          </View>
        )}
      </Card>
    </Section>
  );

  const requestSection = (
    <Section
      title="Request a payment"
      description="Share a QR or broadcast over mesh to start an offline transaction."
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
            <HeadingM>Mesh payments</HeadingM>
            <Body style={styles.helperText}>
              Broadcast requests via BLE mesh when QR or internet is unavailable.
            </Body>
          </View>
          <Switch
            value={meshEnabled}
            onValueChange={toggleMesh}
            trackColor={{ false: 'rgba(148,163,184,0.3)', true: 'rgba(99,102,241,0.5)' }}
            thumbColor={meshEnabled ? '#fff' : '#e2e8f0'}
          />
        </View>
        {meshDiag.started ? (
          <View style={styles.meshStatus}>
            <ActivityIndicator size="small" color={palette.accentBlue} />
            <Body style={styles.helperText}>
              {`Last success: ${meshDiag.lastSuccessAt ? new Date(meshDiag.lastSuccessAt).toLocaleTimeString() : '—'} · Queue: ${meshDiag.queueLength}`}
            </Body>
          </View>
        ) : null}
        {meshDiag.lastError ? (
          <Body style={styles.helperText}>Last error: {meshDiag.lastError}</Body>
        ) : null}
      </Card>
      {/* Nearby Peers Discovery */}
      {meshEnabled && meshDiag.started && <PeerDiscoveryView />}
    </>
  );

  return (
    <>
      <Screen header={hero} refreshControl={refreshControl}>
        {receiptsSection}
        {requestSection}
        {meshSection}
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
        subtitle={merchantAddress ? `Merchant ${merchantAddress.slice(0,8)}…${merchantAddress.slice(-6)}` : undefined}
        amountLabel={`$${parseFloat(amount || '0').toFixed(2)} USDC`}
        onCancel={() => setConfirmSheet(false)}
        onConfirm={() => confirmRef.current && confirmRef.current()}
        stage={sheetStage}
        progress={sheetProgress}
      />
    </>
  );
}

const styles = StyleSheet.create({
  emojiIcon: {
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
    backgroundColor: 'rgba(22,78,99,0.35)',
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
  disputeButton: {
    alignSelf: 'center',
    minWidth: 140,
  },
  emptyState: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: 'rgba(56,189,248,0.12)',
    gap: spacing.md,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
  emptyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.sm,
  },
  emptyButton: {
    flex: 1,
    minHeight: 48,
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
  meshStatus: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  helperText: {
    color: 'rgba(148,163,184,0.82)',
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
});
