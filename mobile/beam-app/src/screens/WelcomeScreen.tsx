import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { HeadingXL, HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, spacing } from '../design/tokens';

interface WelcomeScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
  };
}

export function WelcomeScreen({ navigation }: WelcomeScreenProps) {
  const handleCustomerPath = () => {
    navigation.navigate('WalletCreation', { role: 'customer' });
  };

  const handleMerchantPath = () => {
    navigation.navigate('WalletCreation', { role: 'merchant' });
  };

  return (
    <Screen scrollable={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <HeadingXL style={styles.logo}>⚡</HeadingXL>
          </View>
          <HeadingXL style={styles.title}>Beam</HeadingXL>
          <Body style={styles.subtitle}>
            Offline-first payments that work when networks don't
          </Body>
        </View>

        <View style={styles.content}>
          <Card style={styles.roleCard}>
            <View style={styles.roleHeader}>
              <HeadingM>💸 I want to pay</HeadingM>
              <Small style={styles.roleDescription}>
                Make secure offline payments with USDC using trusted escrow
              </Small>
            </View>
            <View style={styles.featureList}>
              <Body style={styles.feature}>✓ Create secure wallet with biometric protection</Body>
              <Body style={styles.feature}>✓ Fund with devnet SOL and USDC</Body>
              <Body style={styles.feature}>✓ Pay merchants even when offline</Body>
            </View>
            <Button
              label="Continue as customer"
              onPress={handleCustomerPath}
              style={styles.primaryButton}
            />
          </Card>

          <Card style={styles.roleCard}>
            <View style={styles.roleHeader}>
              <HeadingM>💰 I want to receive payments</HeadingM>
              <Small style={styles.roleDescription}>
                Accept offline payments via QR codes and mesh networks
              </Small>
            </View>
            <View style={styles.featureList}>
              <Body style={styles.feature}>✓ Create secure wallet with biometric protection</Body>
              <Body style={styles.feature}>✓ Generate payment QR codes instantly</Body>
              <Body style={styles.feature}>✓ Receive payments offline, settle later</Body>
            </View>
            <Button
              label="Continue as merchant"
              onPress={handleMerchantPath}
              variant="secondary"
              style={styles.secondaryButton}
            />
          </Card>
        </View>

        <View style={styles.footer}>
          <Small style={styles.footerText}>
            Powered by Solana • Devnet testing environment
          </Small>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99,102,241,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logo: {
    fontSize: 48,
  },
  title: {
    color: palette.textPrimary,
  },
  subtitle: {
    color: palette.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  content: {
    gap: spacing.lg,
    flex: 1,
    justifyContent: 'center',
  },
  roleCard: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  roleHeader: {
    gap: spacing.sm,
  },
  roleDescription: {
    color: palette.textSecondary,
  },
  featureList: {
    gap: spacing.sm,
  },
  feature: {
    color: 'rgba(148,163,184,0.9)',
    fontSize: 14,
  },
  primaryButton: {
    marginTop: spacing.sm,
  },
  secondaryButton: {
    marginTop: spacing.sm,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  footerText: {
    color: 'rgba(148,163,184,0.6)',
  },
});
