import React, { useState, useEffect, useCallback } from 'react';
import { Alert, ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Config } from '../config';
import { wallet } from '../wallet/WalletManager';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

export function WalletScreen() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [solBalance, setSolBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBalances = useCallback(async (pubkey: PublicKey) => {
    const connection = new Connection(Config.solana.rpcUrl, Config.solana.commitment);

    try {
      const lamports = await connection.getBalance(pubkey);
      setSolBalance(lamports / LAMPORTS_PER_SOL);
    } catch (err) {
      if (__DEV__) {
        console.warn('Failed to fetch SOL balance', err);
      }
      setSolBalance(0);
    }

    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(pubkey, {
        mint: new PublicKey(Config.tokens.usdc.mint),
      });

      if (tokenAccounts.value.length === 0) {
        setUsdcBalance(0);
        return;
      }

      const parsed = await connection.getParsedAccountInfo(tokenAccounts.value[0].pubkey);
      if (parsed.value && 'parsed' in parsed.value.data) {
        const tokenAmount = parsed.value.data.parsed.info.tokenAmount;
        setUsdcBalance(tokenAmount.uiAmount || 0);
      } else {
        setUsdcBalance(0);
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('Failed to fetch USDC balance', err);
      }
      setUsdcBalance(0);
    }
  }, []);

  const loadWallet = useCallback(async () => {
    setLoading(true);
    try {
      const pubkey = await wallet.loadWallet();
      if (pubkey) {
        const address = pubkey.toBase58();
        setPublicKey(address);
        await fetchBalances(pubkey);
      } else {
        setPublicKey(null);
        setUsdcBalance(0);
        setSolBalance(0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to load wallet:\n${message}`);
    } finally {
      setLoading(false);
    }
  }, [fetchBalances]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const createWallet = async () => {
    setLoading(true);
    try {
      const pubkey = await wallet.createWallet();
      setPublicKey(pubkey.toBase58());
      await fetchBalances(pubkey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to create wallet:\n${message}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshBalances = useCallback(async () => {
    setRefreshing(true);
    try {
      const pk = wallet.getPublicKey();
      if (!pk) {
        return;
      }
      await fetchBalances(pk);
    } finally {
      setRefreshing(false);
    }
  }, [fetchBalances]);

  const walletStatus = publicKey
    ? { label: 'Wallet ready', status: 'online' as const }
    : { label: 'Wallet missing', status: 'offline' as const };

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={refreshBalances} tintColor={palette.accentBlue} />
  );

  const hero = (
    <Hero
      chip={<StatusBadge status={walletStatus.status} label={walletStatus.label} icon="🔐" />}
      title={publicKey ? 'Manage your Beam wallet' : 'Create a secure Beam wallet'}
      subtitle={
        publicKey
          ? 'Biometrically protected keys and escrow balances are ready for offline settlements.'
          : 'Provision a Solana wallet, secure it in the enclave, and fund it for escrow.'
      }
      right={
        <Card variant="glass" padding="lg" style={styles.heroCard}>
          <Small style={styles.muted}>USDC Balance</Small>
          <HeadingM>${usdcBalance.toFixed(2)}</HeadingM>
          <Body style={styles.heroSub}>SOL: {solBalance.toFixed(3)}</Body>
        </Card>
      }
    />
  );

  const controlsSection = publicKey ? (
    <Section
      title="Balances"
      description="Keep at least a small SOL buffer for transaction fees before settling bundles."
      action={<Button label="Refresh" onPress={refreshBalances} loading={refreshing} />}
    >
      <Card style={styles.metricsCard}>
        <View style={styles.metricsRow}>
          <Metric label="USDC" value={`$${usdcBalance.toFixed(2)}`} caption="Escrow funding" accent="purple" />
          <Metric label="SOL" value={solBalance.toFixed(3)} caption="Fee reserve" accent="blue" />
        </View>
      </Card>
    </Section>
  ) : (
    <Section
      title="Provision wallet"
      description="Beam stores seeds in the secure enclave. Back up the phrase before continuing."
    >
      <Card style={styles.callout}>
        <Body style={styles.helper}>No wallet detected. Create a new one or import via the native keychain flow.</Body>
        <Button label="Create wallet" onPress={createWallet} loading={loading} />
      </Card>
    </Section>
  );

  const credentialsSection = publicKey ? (
    <Section
      title="Credentials"
      description="Share your address with customers so they can fund escrow or verify receipts."
    >
      <Card variant="glass" padding="lg" style={styles.credentialsCard}>
        <Small style={styles.muted}>Public key</Small>
        <Body selectable numberOfLines={2} style={styles.address}>
          {publicKey}
        </Body>
        <Body style={styles.helper}>Tap and hold to copy this address to your clipboard.</Body>
      </Card>
    </Section>
  ) : null;

  return (
    <>
      <Screen header={hero} refreshControl={refreshControl}>
        {controlsSection}
        {credentialsSection}
      </Screen>

      {loading ? (
        <View style={styles.loadingOverlay}>
          <Card variant="glass" padding="lg" style={styles.loadingCard}>
            <ActivityIndicator size="large" color={palette.accentBlue} />
            <Body style={styles.loadingBody}>Securing wallet keys…</Body>
          </Card>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    gap: spacing.sm,
  },
  heroSub: {
    color: 'rgba(148,163,184,0.9)',
  },
  muted: {
    color: 'rgba(226,232,240,0.72)',
  },
  metricsCard: {
    gap: spacing.lg,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  callout: {
    gap: spacing.md,
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
  },
  credentialsCard: {
    gap: spacing.md,
  },
  address: {
    fontFamily: 'Menlo',
    backgroundColor: 'rgba(15,23,42,0.65)',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
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
