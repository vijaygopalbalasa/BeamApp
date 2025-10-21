import React, { useState } from 'react';
import { View, TextInput, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wallet } from '../wallet/WalletManager';
import { BeamProgramClient } from '../solana/BeamProgram';
import { Config } from '../config';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Body, Small, Micro } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

const ONBOARDING_COMPLETE_KEY = '@beam:onboarding_complete';

interface EscrowSetupScreenProps {
  navigation: {
    navigate: (screen: string) => void;
  };
}

export function EscrowSetupScreen({ navigation }: EscrowSetupScreenProps) {
  const [loading, setLoading] = useState(false);
  const [initialAmount, setInitialAmount] = useState('100');

  const createEscrow = async () => {
    try {
      // Validate input
      const amount = parseFloat(initialAmount);
      if (isNaN(amount) || amount <= 0) {
        Alert.alert('Invalid Amount', 'Please enter a valid positive number for the USDC amount.');
        return;
      }

      if (amount > 1000000) {
        Alert.alert('Amount Too Large', 'Please enter a reasonable amount (less than 1,000,000 USDC).');
        return;
      }

      const signer = await wallet.getSigner('Create Beam escrow');
      if (!signer) {
        throw new Error('Wallet not loaded');
      }

      const client = new BeamProgramClient(Config.solana.rpcUrl, signer);
      const amountLamports = Math.floor(amount * 1_000_000);

      Alert.alert(
        'Create Escrow',
        `Create escrow with ${amount.toFixed(2)} USDC?\n\nThis will:\n• Create escrow account\n• Transfer ${amount.toFixed(2)} USDC to escrow\n• Require SOL for fees\n\nContinue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Create',
            onPress: async () => {
              setLoading(true);
              try {
                const tx = await client.initializeEscrow(amountLamports);
                await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');

                Alert.alert(
                  'Escrow Created',
                  `Transaction: ${tx}\n\nYou can now make offline payments!`,
                  [{ text: 'Continue', onPress: () => navigation.navigate('CustomerDashboard') }]
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Alert.alert('Error', `Failed to create escrow:\n${message}`);
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

  return (
    <Screen
      header={
        <Hero
          chip={<StatusBadge status="pending" label="Final step" icon="🎯" />}
          title="Create escrow account"
          subtitle="Lock USDC into your personal escrow for offline payments"
        />
      }
    >
      <Section
        title="How escrow works"
        description="Your funds remain under your control"
      >
        <Card>
          <Body style={styles.body}>
            ✓ USDC locked in program-controlled escrow
            {'\n'}✓ Only you can authorize payments
            {'\n'}✓ Withdraw anytime
            {'\n'}✓ Replay protection via nonces
            {'\n'}✓ Verifier validates settlements
          </Body>
        </Card>
      </Section>

      <Section title="Initial escrow amount">
        <Card>
          <Micro>USDC AMOUNT</Micro>
          <TextInput
            style={styles.input}
            value={initialAmount}
            onChangeText={setInitialAmount}
            keyboardType="decimal-pad"
            placeholder="100"
            placeholderTextColor="rgba(226,232,240,0.4)"
          />
          <Small style={styles.helper}>
            Recommended: Start with 100 USDC for initial funding
          </Small>
          <Button
            label={loading ? 'Creating...' : 'Create escrow'}
            onPress={createEscrow}
            loading={loading}
            disabled={loading}
            style={styles.button}
          />
        </Card>
      </Section>

      {loading && (
        <View style={styles.loadingOverlay}>
          <Card variant="glass" padding="lg" style={styles.loadingCard}>
            <ActivityIndicator size="large" color={palette.accentBlue} />
            <Body>Creating escrow account...</Body>
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    color: 'rgba(148,163,184,0.9)',
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
    fontSize: 18,
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.lg,
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
});
