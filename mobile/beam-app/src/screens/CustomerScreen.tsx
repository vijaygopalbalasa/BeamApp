import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, Modal, RefreshControl } from 'react-native';
import { wallet } from '../wallet/WalletManager';
import { createUnsignedBundle, serializeBundle, type AttestationEnvelope } from '@beam/shared';
import type { OfflineBundle } from '@beam/shared';
import { SettlementService } from '../services/SettlementService';
import { bundleStorage } from '../storage/BundleStorage';
import { PublicKey } from '@solana/web3.js';
import { QRScanner } from '../components/QRScanner';
import { Config } from '../config';
import { attestationService } from '../services/AttestationService';
import { meshNetwork } from '../services/MeshNetworkService';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingL, HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';
import type { BundleHistoryEntry, FraudRecordEntry } from '../solana/types';

function TextIcon({ label }: { label: string }) {
  return <Small style={styles.textIcon}>{label}</Small>;
}

const settlementService = new SettlementService();

export function CustomerScreen() {
  const [escrowBalance, setEscrowBalance] = useState(0);
  const [pendingBundles, setPendingBundles] = useState<OfflineBundle[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [history, setHistory] = useState<BundleHistoryEntry[]>([]);
  const [fraudRecords, setFraudRecords] = useState<FraudRecordEntry[]>([]);
  const [meshDiag, setMeshDiag] = useState(meshNetwork.getDiagnostics());
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const meshUnsubscribe = useRef<(() => void) | null>(null);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      // Ensure wallet is loaded from secure storage
      const walletPubkey = await wallet.loadWallet();
      setWalletAddress(walletPubkey?.toBase58() ?? null);

      // Load pending bundles from storage
      const bundles = await bundleStorage.loadBundles();
      setPendingBundles(bundles);

      // Load nonce from storage
      const nonce = await bundleStorage.loadNonce();
      wallet.setNonce(nonce);

      // Check if online
      const online = await settlementService.isOnline();
      setIsOnline(online);

      // Get escrow balance if online
      const pubkey = wallet.getPublicKey();
      if (pubkey && online) {
        try {
          const signer = await wallet.getSigner('Fetch escrow balance');
          if (signer) {
            settlementService.initializeClient(signer);
            const balance = await settlementService.getEscrowBalance(pubkey);
            setEscrowBalance(balance);
            const registry = await settlementService.getNonceRegistrySnapshot(pubkey, signer);
            if (registry) {
              const recentHistory = [...registry.bundleHistory].slice(-5).reverse();
              const recentFraud = [...registry.fraudRecords].slice(-3).reverse();
              setHistory(recentHistory);
              setFraudRecords(recentFraud);
            }
          }
        } catch (err) {
          if (__DEV__) {
            console.log('Could not fetch balance:', err);
          }
        }
      }
    } catch (err) {
      if (__DEV__) {
        console.error('Load error:', err);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = meshNetwork.addDiagnosticsListener(diag => setMeshDiag(diag));
    return unsubscribe;
  }, []);

  useEffect(() => {
    meshUnsubscribe.current?.();
    meshUnsubscribe.current = null;

    if (!walletAddress) {
      return () => {};
    }

    let cancelled = false;

    const subscribeToMesh = async () => {
      try {
        await meshNetwork.ensureActive(Config.ble.serviceUUID);
        const unsubscribe = await meshNetwork.subscribe(async message => {
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
          setPendingBundles(refreshed);

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
  }, [walletAddress]);

  const handleQRScan = async (qrData: string) => {
    setShowScanner(false);
    setLoading(true);

    try {
      const paymentRequest = JSON.parse(qrData);

      if (paymentRequest.type !== 'pay') {
        Alert.alert('Invalid QR', 'This QR code is not a valid payment request.');
        return;
      }

      const merchant = paymentRequest.merchant || paymentRequest.merchantPubkey;
      if (!merchant || !paymentRequest.amount) {
        Alert.alert('Invalid QR', 'This QR code is missing payment details.');
        return;
      }

      await createPayment(
        merchant,
        paymentRequest.amount,
        paymentRequest.description || 'Payment'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to process QR code:\n${message}`);
    } finally {
      setLoading(false);
    }
  };

  const createPayment = async (
    merchantPubkey: string,
    amount: number,
    description: string = 'Payment'
  ) => {
    const payerPubkey = wallet.getPublicKey();
    if (!payerPubkey) {
      Alert.alert('Error', 'Wallet not loaded. Please go to Setup.');
      return;
    }

    try {
      // Get escrow PDA
      const escrowPDA = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), payerPubkey.toBuffer()],
        new PublicKey(Config.program.id)
      )[0].toBase58();

      const tokenMint = Config.tokens.usdc.mint; // USDC
      const tokenDecimals = Config.tokens.usdc.decimals;

      // Get next nonce
      const nonce = await bundleStorage.incrementNonce();
      wallet.setNonce(nonce);

      // Create offline bundle
      const unsignedBundle = createUnsignedBundle(
        escrowPDA,
        payerPubkey.toBase58(),
        merchantPubkey,
        amount,
        tokenMint,
        tokenDecimals,
        nonce
      );

      const serialized = serializeBundle(unsignedBundle);
      const payerSignature = await attestationService.signPayload(serialized, 'Authorize offline payment');
      const bundle = {
        ...unsignedBundle,
        payer_signature: payerSignature,
      };

      // Store bundle persistently (legacy storage)
      await bundleStorage.addBundle(bundle);

      // Attempt to store inside secure storage + fetch attestation envelope
      const metadata = {
        amount,
        currency: 'USDC',
        merchantPubkey,
        payerPubkey: payerPubkey.toBase58(),
        nonce,
        createdAt: bundle.timestamp,
      };
      let payerAttestation: AttestationEnvelope | undefined;
      try {
        payerAttestation = await attestationService.storeBundle(bundle, metadata, {
          selfRole: 'payer',
        });
      } catch (err) {
        if (__DEV__) {
          console.warn('Failed to store attested bundle', err);
        }
      }

      try {
      await meshNetwork.queueBundle(
        bundle,
        Config.ble.serviceUUID,
        payerAttestation
      );
      } catch (err) {
        if (__DEV__) {
          console.error('Failed to queue bundle for mesh broadcast', err);
        }
      }

      // Update UI
      const bundles = await bundleStorage.loadBundles();
      setPendingBundles(bundles);

      Alert.alert(
        '✓ Payment Created',
        `${description}\n\nAmount: $${(amount / 1_000_000).toFixed(2)} USDC\nNonce: ${nonce}\n\nPayment stored locally and ready for settlement.`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      throw err;
    }
  };

  const mockPayment = async () => {
    Alert.alert(
      'Test Payment',
      'Please use the QR scanner to scan a merchant payment request.\n\nFor testing, generate a QR code from the Merchant screen.',
      [{ text: 'OK' }]
    );
  };

  const settleAll = async () => {
    if (pendingBundles.length === 0) {
      Alert.alert('No Bundles', 'No pending payments to settle.');
      return;
    }

    if (!isOnline) {
      Alert.alert('Offline', 'Cannot settle payments while offline. Please connect to internet.');
      return;
    }

    const signer = await wallet.getSigner('Settle offline payments');
    if (!signer) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    setLoading(true);
    try {
      // Initialize client
      settlementService.initializeClient(signer);

      const results = await settlementService.settleAllPending(signer);

      // Update storage - remove settled bundles
      const remaining = await bundleStorage.loadBundles();
      setPendingBundles(remaining);

      await Promise.all(
        results.success.map(result => attestationService.removeBundle(result.bundleId).catch(() => undefined))
      );

      Alert.alert(
        '✓ Settlement Complete',
        `Success: ${results.success.length}\nFailed: ${results.failed.length}\n\n${
          results.success.length > 0
            ? 'Bundles:\n' + results.success.map(s => s.bundleId.slice(0, 16) + '...').join('\n')
            : ''
        }`,
        [{ text: 'OK', onPress: loadData }]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Settlement Error', message);
    } finally {
      setLoading(false);
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
              <Card variant="glass" padding="lg" style={styles.heroCard}>
                <Small style={styles.labelMuted}>Escrow balance</Small>
                <HeadingL>
                  {isOnline ? `$${(escrowBalance / 1_000_000).toFixed(2)}` : 'Check connection'}
                </HeadingL>
                <Body style={styles.heroSub}>USDC held securely in Beam escrow</Body>
              </Card>
            }
          />
        }
      >
        <Section
          title="Quick actions"
          description="Share bundles over QR, mesh, or BLE when traditional networks fail."
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
                label="Create test payment"
                icon={<TextIcon label="💰" />}
                variant="secondary"
                onPress={mockPayment}
                disabled={loading}
              />
            </View>
            <Small style={styles.helperText}>
              Tip: Merchants can broadcast payment requests via QR or mesh witnesses.
            </Small>
          </Card>
        </Section>

        <Section
          title="Offline bundles"
          description="Track pending payments and settle when the verifier is reachable."
          action={
            pendingBundles.length && isOnline ? (
              <Button
                label={loading ? 'Settling…' : 'Settle all'}
                onPress={settleAll}
                loading={loading}
              />
            ) : undefined
          }
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

            {pendingBundles.length > 0 ? (
              <View style={styles.bundleList}>
                {pendingBundles.slice(0, 4).map(bundle => (
                  <View key={bundle.tx_id} style={styles.bundleRow}>
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
                <HeadingM>No pending bundles</HeadingM>
                <Body style={styles.helperText}>Create a payment and it will appear here until settled on-chain.</Body>
              </View>
            )}
          </Card>
        </Section>

        <Section
          title="Recent settlements"
          description="Ring-buffer of bundles recorded on-chain for dispute resolution."
        >
          <Card style={styles.historyCard}>
            {history.length > 0 ? (
              <View style={styles.historyList}>
                {history.map(entry => (
                  <View key={`${entry.bundleHash}-${entry.nonce}`} style={styles.historyRow}>
                    <View style={styles.historyContent}>
                      <HeadingM>{`$${entry.amount.toFixed(2)} USDC`}</HeadingM>
                      <Body style={styles.helperText}>
                        {`Nonce ${entry.nonce} · ${new Date(entry.settledAt).toLocaleString()}`}
                      </Body>
                    </View>
                    <Small style={styles.hashLabel}>{entry.bundleHash.slice(0, 10)}…</Small>
                  </View>
                ))}
              </View>
            ) : (
              <Body style={styles.helperText}>History appears after your first on-chain settlement.</Body>
            )}
          </Card>
        </Section>

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

      {loading ? (
        <View style={styles.loadingOverlay}>
          <Card variant="glass" padding="lg" style={styles.loadingCard}>
            <ActivityIndicator size="large" color={palette.accentBlue} />
            <Body style={styles.loadingBody}>Authorizing Solana transactions…</Body>
          </Card>
        </View>
      ) : null}

      <Modal visible={showScanner} animationType="slide" presentationStyle="fullScreen">
        <QRScanner onScan={handleQRScan} onClose={() => setShowScanner(false)} />
      </Modal>
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
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(79,70,229,0.08)',
    gap: spacing.sm,
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
});
