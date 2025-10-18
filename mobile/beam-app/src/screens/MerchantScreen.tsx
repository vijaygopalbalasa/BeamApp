import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, ActivityIndicator, RefreshControl, TextInput, Switch, View, StyleSheet } from 'react-native';
import type { BeamQRPaymentRequest, OfflineBundle } from '@beam/shared';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import bs58 from 'bs58';
import { wallet } from '../wallet/WalletManager';
import { serializeBundle, verifyCompletedBundle } from '@beam/shared';
import { SettlementService } from '../services/SettlementService';
import { meshNetwork, type MeshBundleMessage, type MeshDiagnostics } from '../services/MeshNetworkService';
import { Config } from '../config';
import { attestationService } from '../services/AttestationService';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

const MERCHANT_RECEIVED_KEY = '@beam:merchant_received';
const settlementService = new SettlementService();

function EmojiIcon({ symbol }: { symbol: string }) {
  return <Small style={styles.emojiIcon}>{symbol}</Small>;
}

export function MerchantScreen() {
  const [amount, setAmount] = useState('10.00');
  const [qrData, setQRData] = useState<string | null>(null);
  const [meshEnabled, setMeshEnabled] = useState(false);
  const [receivedPayments, setReceivedPayments] = useState<OfflineBundle[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [merchantAddress, setMerchantAddress] = useState<string | null>(null);
  const [meshDiag, setMeshDiag] = useState<MeshDiagnostics>(meshNetwork.getDiagnostics());
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const meshUnsubscribe = useRef<(() => void) | null>(null);

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
    const unsubscribe = meshNetwork.addDiagnosticsListener(diag => {
      setMeshDiag(diag);
      setMeshEnabled(diag.started);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      meshUnsubscribe.current?.();
      meshUnsubscribe.current = null;
      if (meshEnabled) {
        meshNetwork.stopMeshNode().catch(err => {
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

  const generatePaymentQR = async () => {
    let merchantPubkey = wallet.getPublicKey();
    if (!merchantPubkey) {
      merchantPubkey = await wallet.loadWallet();
    }

    if (!merchantPubkey) {
      Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
      return;
    }

    try {
      const qrPayload: BeamQRPaymentRequest = {
        type: 'pay',
        merchant: merchantPubkey.toBase58(),
        amount: parseFloat(amount) * 1_000_000,
        currency: 'USD',
        display_amount: amount,
        timestamp: Date.now(),
      };

      setQRData(JSON.stringify(qrPayload));
      Alert.alert('✓ QR Code Generated', 'Show this QR code to your customer to receive payment.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to generate QR:\n${message}`);
    }
  };

  const handleIncomingBundle = useCallback(
    async (message: MeshBundleMessage) => {
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

        let snapshot: OfflineBundle[] | null = null;
        setReceivedPayments(prev => {
          if (prev.some(payment => payment.tx_id === signedBundle.tx_id)) {
            return prev;
          }
          const updated = [signedBundle, ...prev];
          snapshot = updated;
          return updated;
        });

        if (snapshot) {
          await saveReceivedPayments(snapshot);
        }

        let merchantAttestation;
        try {
          merchantAttestation = await attestationService.storeBundle(
            signedBundle,
            {
              amount: signedBundle.token.amount,
              currency: signedBundle.token.symbol,
              merchantPubkey: signedBundle.merchant_pubkey,
              payerPubkey: signedBundle.payer_pubkey,
              nonce: signedBundle.nonce,
              createdAt: signedBundle.timestamp,
            },
            {
              payerAttestation,
              selfRole: 'merchant',
            }
          );
        } catch (err) {
          if (__DEV__) {
            console.warn('Failed to store attested merchant bundle', err);
          }
        }

        try {
          await meshNetwork.queueBundle(
            signedBundle,
            Config.ble.serviceUUID,
            payerAttestation,
            merchantAttestation
          );
        } catch (err) {
          if (__DEV__) {
            console.error('Failed to broadcast signed bundle', err);
          }
        }

        Alert.alert('Payment Received', `Amount: $${(signedBundle.token.amount / 1_000_000).toFixed(2)} USDC\nNonce: ${signedBundle.nonce}`);
      } catch (err) {
        if (__DEV__) {
          console.error('Failed to process mesh bundle', err);
        }
      }
    },
    [saveReceivedPayments]
  );

  const toggleMesh = async () => {
    if (!meshEnabled) {
      try {
        setLoading(true);
        const merchantPubkey = await wallet.loadWallet();
        if (!merchantPubkey) {
          Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
          return;
        }

        await meshNetwork.ensureActive(Config.ble.serviceUUID);
        const unsubscribe = await meshNetwork.subscribe(handleIncomingBundle, Config.ble.serviceUUID);
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
      await meshNetwork.stopMeshNode();
      setMeshEnabled(false);
    }
  };

  const simulatePaymentReceived = () => {
    Alert.alert(
      'Test Payment',
      'Offline flow: customer scans, signs, and beams a bundle. Use two devices—one as merchant, one as customer—to try it end to end.'
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
              const settledIds = new Set(results.success.map(result => result.bundleId));

              if (settledIds.size > 0) {
                const updatedPayments = receivedPayments.filter(p => !settledIds.has(p.tx_id));
                setReceivedPayments(updatedPayments);
                await saveReceivedPayments(updatedPayments);
                await Promise.all(
                  Array.from(settledIds).map(id => attestationService.removeBundle(id).catch(() => undefined))
                );
              }

              Alert.alert(
                '✓ Settlement Complete',
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
      status={meshDiag.queueLength > 0 ? 'pending' : meshDiag.started ? 'online' : 'offline'}
      label={meshDiag.queueLength > 0 ? `${meshDiag.queueLength} queued` : meshDiag.started ? 'Mesh broadcasting' : 'Mesh disabled'}
      icon={meshDiag.queueLength > 0 ? '🔁' : meshDiag.started ? '📡' : '🛑'}
    />
  );

  const hero = (
    <Hero
      chip={meshBadge}
      title="Merchant"
      subtitle={
        meshDiag.started
          ? 'Device is discoverable over mesh. Customers can beam payments instantly.'
          : 'Generate payment requests or enable mesh to keep accepting Beam payments offline.'
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
      description="Attested bundles signed by your customers stay locally until you settle."
      action={
        receivedPayments.length > 0 ? (
          <Button label="Settle receipts" onPress={settleMerchantPayments} loading={loading} />
        ) : undefined
      }
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
            <Body style={styles.helperText}>Generated payments appear here with attestation details.</Body>
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

        {qrData ? (
          <Card variant="glass" padding="lg" style={styles.qrCard}>
            <QRCode value={qrData} size={220} backgroundColor="#fff" color="#000" />
            <Body style={styles.helperText}>Show this to the customer; bundles sync instantly.</Body>
            <View style={styles.qrActions}>
              <Button label="Simulate" onPress={simulatePaymentReceived} variant="secondary" icon={<EmojiIcon symbol="🎓" />} />
              <Button label="Clear" onPress={() => setQRData(null)} variant="ghost" />
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
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(56,189,248,0.12)',
    gap: spacing.sm,
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
