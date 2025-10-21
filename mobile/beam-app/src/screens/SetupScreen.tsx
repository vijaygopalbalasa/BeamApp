import React, { useState, useEffect, useCallback } from 'react';
import { View, TextInput, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { wallet } from '../wallet/WalletManager';
import { BeamProgramClient } from '../solana/BeamProgram';
import { Config } from '../config';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { HeadingL, Body, Small, Micro } from '../components/ui/Typography';
import { StatusBadge } from '../components/ui/StatusBadge';
import { palette, radius, spacing } from '../design/tokens';

interface SetupScreenProps {
  navigation: {
    navigate: (screen: string) => void;
  };
}

export function SetupScreen({ navigation }: SetupScreenProps) {
  const [loading, setLoading] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [hasEscrow, setHasEscrow] = useState(false);
  const [publicKey, setPublicKey] = useState<string>('');
  const [initialAmount, setInitialAmount] = useState('100');

  const checkStatus = useCallback(async () => {
    const pubkey = await wallet.loadWallet();
    if (pubkey) {
      setHasWallet(true);
      setPublicKey(pubkey.toBase58());

      // Check if escrow exists
      const signer = await wallet.getSigner();
      if (signer) {
        const client = new BeamProgramClient(Config.solana.rpcUrl, signer);
        const escrow = await client.getEscrowAccount(pubkey);
        if (escrow) {
          setHasEscrow(true);
        }
      }
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const createWallet = async () => {
    setLoading(true);
    try {
      const pubkey = await wallet.createWallet();
      setPublicKey(pubkey.toBase58());
      setHasWallet(true);
      Alert.alert('Success', `Wallet created!\n\nPublic Key:\n${pubkey.toBase58()}\n\nPlease save this address and fund it with devnet SOL and USDC.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const createEscrow = async () => {
    try {
      const signer = await wallet.getSigner('Create Beam escrow');
      if (!signer) {
        throw new Error('Wallet not loaded');
      }

      const client = new BeamProgramClient(Config.solana.rpcUrl, signer);
      const amountLamports = parseFloat(initialAmount) * 1_000_000; // USDC has 6 decimals

      Alert.alert(
        'Create Escrow',
        `This will create an escrow account and transfer ${initialAmount} USDC to it.\n\nMake sure you have:\n- SOL for transaction fees\n- ${initialAmount} USDC in your wallet\n\nContinue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: async () => {
              setLoading(true);
              try {
                const tx = await client.initializeEscrow(amountLamports);
                setHasEscrow(true);
                Alert.alert(
                  'Success',
                  `Escrow created!\n\nTransaction: ${tx}\n\nYou can now use Beam for offline payments.`
                );
                navigation.navigate('CustomerDashboard');
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Alert.alert(
                  'Error',
                  `Failed to create escrow:\n${message}\n\nMake sure you have USDC and SOL in your wallet.`
                );
              } finally {
                setLoading(false);
              }
            },
          },
        ]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', message);
    }
  };

  if (loading) {
    return (
      <Screen scrollable={false}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={palette.accentBlue} />
          <Body style={styles.loadingCopy}>Processing secure instructions…</Body>
        </View>
      </Screen>
    );
  }

  const walletStatus = hasWallet
    ? { label: 'Wallet secured', status: 'online' as const }
    : { label: 'Wallet not initialized', status: 'offline' as const };

  const escrowStatus = hasEscrow
    ? { label: 'Escrow ready', status: 'online' as const }
    : { label: 'Escrow pending', status: hasWallet ? 'pending' as const : 'offline' as const };

  return (
    <Screen
      header={
        <Hero
          chip={<StatusBadge status={walletStatus.status} label={walletStatus.label} icon="🔐" />}
          title={hasEscrow ? 'You are ready to Beam' : 'Finish setting up Beam'}
          subtitle={
            hasEscrow
              ? 'Wallet, escrow, and attestation services are configured. Continue to manage payments.'
              : 'Create a secure wallet, fund escrow, and unlock offline payments that survive network outages.'
          }
          right={
            <Card variant="glass" padding="lg" style={styles.heroCard}>
              <Small style={styles.heroLabel}>Escrow status</Small>
              <HeadingL>{escrowStatus.label}</HeadingL>
              <Body style={styles.heroSub}>Escrow enables trusted offline settlements</Body>
            </Card>
          }
        />
      }
    >
      <Section
        title="1. Secure your wallet"
        description="Beam stores keys in the device secure enclave with biometric protection."
        action={
          !hasWallet ? (
            <Button label="Create wallet" onPress={createWallet} />
          ) : (
            <StatusBadge status="online" label="Created" icon="✅" />
          )
        }
      >
        <Card>
          <Body>
            Generate a new Solana wallet dedicated to Beam. The recovery phrase stays on-device—back it up before
            continuing.
          </Body>
          {hasWallet ? (
            <View style={styles.kvRow}>
              <Micro>PUBLIC KEY</Micro>
              <Body selectable numberOfLines={1} style={styles.address}>
                {`${publicKey.slice(0, 16)}…${publicKey.slice(-12)}`}
              </Body>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section
        title="2. Fund and create escrow"
        description="Escrow accounts hold USDC for offline payments with replay protection."
      >
        <Card style={styles.escrowCard}>
          <Body style={styles.infoCopy}>
            Fund the wallet with devnet SOL for fees and USDC for escrow. When ready, choose an initial USDC amount to
            lock into escrow. Funds remain under your control and can be withdrawn anytime.
          </Body>
          <View style={styles.formRow}>
            <View style={styles.inputField}>
              <Micro>INITIAL USDC</Micro>
              <TextInput
                style={styles.input}
                value={initialAmount}
                onChangeText={setInitialAmount}
                keyboardType="decimal-pad"
                placeholder="Amount"
                placeholderTextColor="rgba(226,232,240,0.4)"
              />
            </View>
            <Button
              label={hasEscrow ? 'Escrow ready' : 'Create escrow'}
              onPress={createEscrow}
              disabled={!hasWallet || hasEscrow}
              variant={hasEscrow ? 'secondary' : 'primary'}
              style={styles.createButton}
            />
          </View>
          <Small style={styles.helper}>
            Need tokens? Visit faucet.solana.com for SOL and the SPL Token Faucet for devnet USDC.
          </Small>
        </Card>
      </Section>

      {hasEscrow ? (
        <Section
          title="3. Launch the app"
          description="Jump into the main experience to send and receive offline payments."
          action={<Button label="Open dashboard" onPress={() => navigation.navigate('Main')} />}
        >
          <Card variant="highlight">
            <Body>
              You now have a biometric-protected wallet, funded escrow, and built-in attestation. Continue to the home
              screen to issue payments, scan merchants, and manage settlements.
            </Body>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingCopy: {
    color: palette.textSecondary,
  },
  heroCard: {
    gap: spacing.sm,
    minWidth: 200,
  },
  heroLabel: {
    color: 'rgba(226,232,240,0.72)',
  },
  heroSub: {
    color: palette.textSecondary,
  },
  kvRow: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 14,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    color: palette.textSecondary,
  },
  escrowCard: {
    gap: spacing.md,
  },
  infoCopy: {
    color: palette.textSecondary,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inputField: {
    flex: 1,
  },
  input: {
    marginTop: spacing.xs,
    backgroundColor: 'rgba(15,23,42,0.65)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.textPrimary,
    fontSize: 16,
  },
  createButton: {
    minWidth: 140,
    height: 52,
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
  },
});
