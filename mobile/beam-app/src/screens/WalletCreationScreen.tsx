import React, { useState } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wallet } from '../wallet/WalletManager';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { HeadingM, Body, Small, Micro } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

const ONBOARDING_ROLE_KEY = '@beam:onboarding_role';
const WALLET_CREATED_KEY = '@beam:wallet_created';

interface WalletCreationScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
    goBack: () => void;
  };
  route: {
    params: {
      role: 'customer' | 'merchant';
    };
  };
}

export function WalletCreationScreen({ navigation, route }: WalletCreationScreenProps) {
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const { role } = route.params;

  const handleCreateWallet = async () => {
    setLoading(true);
    try {
      // Create new Ed25519 keypair with biometric prompt
      const pubkey = await wallet.createWallet();
      const address = pubkey.toBase58();
      setWalletAddress(address);

      // Persist role and wallet creation state
      await AsyncStorage.multiSet([
        [ONBOARDING_ROLE_KEY, role],
        [WALLET_CREATED_KEY, 'true'],
      ]);

      Alert.alert(
        'Wallet Created',
        `Your secure Solana wallet has been created and protected with biometric authentication.\n\nPublic Address:\n${address}\n\n⚠️ Important: Back up your wallet before continuing.`,
        [
          {
            text: 'Continue',
            onPress: handleContinue,
          },
        ]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', `Failed to create wallet:\n${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    navigation.navigate('Funding', { role });
  };

  if (loading) {
    return (
      <Screen scrollable={false}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={palette.accentBlue} />
          <Body style={styles.loadingText}>Creating secure wallet...</Body>
          <Small style={styles.loadingSubtext}>
            Please authenticate with biometrics
          </Small>
        </View>
      </Screen>
    );
  }

  if (walletAddress) {
    return (
      <Screen
        header={
          <Hero
            chip={<StatusBadge status="online" label="Wallet secured" icon="🔐" />}
            title="Wallet ready"
            subtitle="Your Ed25519 keypair is encrypted and stored in the device secure enclave"
          />
        }
      >
        <Section
          title="Your wallet address"
          description="This is your Solana public key for receiving payments"
        >
          <Card>
            <Micro>PUBLIC KEY</Micro>
            <Body selectable style={styles.address}>
              {walletAddress}
            </Body>
            <Small style={styles.helper}>
              This address is derived from your Ed25519 private key, which never leaves your
              device
            </Small>
          </Card>
        </Section>

        <Section
          title="Security features"
          description="Production-grade cryptography protecting your funds"
        >
          <Card style={styles.securityCard}>
            <View style={styles.securityItem}>
              <HeadingM>🔐 Biometric protection</HeadingM>
              <Body style={styles.securityText}>
                Every transaction requires fingerprint or face authentication
              </Body>
            </View>
            <View style={styles.securityItem}>
              <HeadingM>🔒 Hardware-backed encryption</HeadingM>
              <Body style={styles.securityText}>
                AES-256-GCM encryption using Android KeyStore secure enclave
              </Body>
            </View>
            <View style={styles.securityItem}>
              <HeadingM>🔑 Ed25519 cryptography</HeadingM>
              <Body style={styles.securityText}>
                Industry-standard Solana-compatible signature scheme
              </Body>
            </View>
          </Card>
        </Section>

        <Section>
          <Button label="Continue" onPress={handleContinue} />
        </Section>
      </Screen>
    );
  }

  return (
    <Screen
      header={
        <Hero
          chip={<StatusBadge status="pending" label="Ready to start" icon="🚀" />}
          title={role === 'customer' ? 'Create your wallet' : 'Create merchant wallet'}
          subtitle={
            role === 'customer'
              ? 'Generate a secure Solana wallet to start making offline payments'
              : 'Generate a secure Solana wallet to accept payments from customers'
          }
        />
      }
    >
      <Section
        title="How it works"
        description="Beam creates production-ready wallets with enterprise security"
      >
        <Card style={styles.stepsCard}>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Small style={styles.stepNumberText}>1</Small>
            </View>
            <View style={styles.stepContent}>
              <HeadingM>Generate Ed25519 keypair</HeadingM>
              <Body style={styles.stepText}>
                Creates cryptographically secure private/public key pair using Solana's Ed25519
                signature scheme
              </Body>
            </View>
          </View>

          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Small style={styles.stepNumberText}>2</Small>
            </View>
            <View style={styles.stepContent}>
              <HeadingM>Encrypt with AES-256-GCM</HeadingM>
              <Body style={styles.stepText}>
                Private key encrypted using hardware-backed encryption key stored in Android
                KeyStore secure enclave
              </Body>
            </View>
          </View>

          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Small style={styles.stepNumberText}>3</Small>
            </View>
            <View style={styles.stepContent}>
              <HeadingM>Protect with biometrics</HeadingM>
              <Body style={styles.stepText}>
                Every transaction requires biometric authentication—your keys never leave the
                device unencrypted
              </Body>
            </View>
          </View>
        </Card>
      </Section>

      <Section title="Security guarantee" description="Enterprise-grade cryptographic security">
        <Card variant="highlight">
          <Body>
            ✓ Real Ed25519 cryptography (net.i2p.crypto:eddsa)
            {'\n'}✓ Hardware-backed encryption (Android KeyStore)
            {'\n'}✓ Biometric authentication required
            {'\n'}✓ Private keys never transmitted
            {'\n'}✓ Compatible with Solana devnet and mainnet
          </Body>
        </Card>
      </Section>

      <Section>
        <Button
          label="Create secure wallet"
          onPress={handleCreateWallet}
          disabled={loading}
          style={styles.createButton}
        />
        <Small style={styles.disclaimer}>
          By creating a wallet, you confirm you understand that you are responsible for securing
          your device and backup phrase
        </Small>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  loadingText: {
    color: palette.textPrimary,
    fontSize: 18,
  },
  loadingSubtext: {
    color: palette.textSecondary,
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 13,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    color: palette.textPrimary,
    lineHeight: 20,
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
    marginTop: spacing.sm,
  },
  securityCard: {
    gap: spacing.lg,
  },
  securityItem: {
    gap: spacing.xs,
  },
  securityText: {
    color: 'rgba(148,163,184,0.9)',
  },
  stepsCard: {
    gap: spacing.xl,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(99,102,241,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    color: palette.accentBlue,
    fontWeight: '700',
  },
  stepContent: {
    flex: 1,
    gap: spacing.xs,
  },
  stepText: {
    color: 'rgba(148,163,184,0.9)',
  },
  createButton: {
    marginBottom: spacing.md,
  },
  disclaimer: {
    color: 'rgba(148,163,184,0.7)',
    textAlign: 'center',
    lineHeight: 18,
  },
});
