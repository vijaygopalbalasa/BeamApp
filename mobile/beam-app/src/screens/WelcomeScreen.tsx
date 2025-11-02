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
  const handleGetStarted = () => {
    navigation.navigate('WalletCreation');
  };

  const handleImportWallet = () => {
    navigation.navigate('WalletImport');
  };

  return (
    <Screen scrollable={true}>
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
          <Card style={styles.mainCard}>
            <View style={styles.cardContent}>
              <HeadingM style={styles.cardTitle}>One Wallet, Two Roles</HeadingM>
              <Small style={styles.cardDescription}>
                Create a single secure wallet to both send and receive payments
              </Small>
            </View>

            <View style={styles.featureList}>
              <Body style={styles.feature}>✓ Secure wallet with biometric protection</Body>
              <Body style={styles.feature}>✓ Pay merchants offline with USDC</Body>
              <Body style={styles.feature}>✓ Receive payments via QR codes</Body>
              <Body style={styles.feature}>✓ Switch between customer and merchant anytime</Body>
            </View>

            <Button
              label="Create Wallet & Get Started"
              onPress={handleGetStarted}
              style={styles.primaryButton}
            />

            <Button
              label="Import Existing Wallet"
              variant="ghost"
              onPress={handleImportWallet}
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
  mainCard: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  cardContent: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  cardTitle: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
  cardDescription: {
    color: palette.textSecondary,
    textAlign: 'center',
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
