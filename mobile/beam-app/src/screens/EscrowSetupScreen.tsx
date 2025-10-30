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
import { PaymentSheet } from '../components/features/PaymentSheet';
import { connectionService } from '../services/ConnectionService';
import { InfoButton } from '../components/ui/InfoButton';

const ONBOARDING_COMPLETE_KEY = '@beam:onboarding_complete';

interface EscrowSetupScreenProps {
  navigation: {
    navigate: (screen: string) => void;
  };
}

export function EscrowSetupScreen({ navigation }: EscrowSetupScreenProps) {
  const [loading, setLoading] = useState(false);
  const [initialAmount, setInitialAmount] = useState('100');
  const [showSheet, setShowSheet] = useState(false);
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  const [escrowUsdc, setEscrowUsdc] = useState<number | null>(null);
  const [escrowExists, setEscrowExists] = useState(false);
  const [sheetStage, setSheetStage] = useState<'review' | 'submitting' | 'confirming' | 'done' | 'error'>('review');
  const [sheetProgress, setSheetProgress] = useState(0);
  const onConfirmRef = React.useRef<null | (() => void)>(null);

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

      setShowSheet(true);
      const doCreate = async () => {
        setSheetStage('submitting');
        setSheetProgress(0.25);
        try {
          setLoading(true);

          // Check if escrow already exists
          const escrowAccount = await client.getEscrowAccount(signer.publicKey);

          let tx;
          if (escrowAccount) {
            // FUND existing escrow
            console.log('[EscrowSetup] Escrow exists, funding with', amount, 'USDC');
            tx = await client.fundEscrow(amountLamports);
            setSheetStage('confirming');
            setSheetProgress(0.75);
            setSheetStage('done');
            setSheetProgress(1);
            Alert.alert('Escrow Funded', `Added ${amount} USDC to escrow\n\nTransaction: ${tx.slice(0, 20)}...`);
          } else {
            // CREATE new escrow
            console.log('[EscrowSetup] Creating new escrow with', amount, 'USDC');
            tx = await client.initializeEscrow(amountLamports);
            setSheetStage('confirming');
            setSheetProgress(0.75);
            await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
            setSheetStage('done');
            setSheetProgress(1);
            Alert.alert('Escrow Created', `Created escrow with ${amount} USDC\n\nTransaction: ${tx.slice(0, 20)}...`);
          }

          setShowSheet(false);
          navigation.navigate('CustomerDashboard');
        } catch (err) {
          setSheetStage('error');
          const message = err instanceof Error ? err.message : String(err);
          Alert.alert('Error', `Failed to ${escrowAccount ? 'fund' : 'create'} escrow:\n${message}`);
        } finally {
          setLoading(false);
        }
      };
      // Attach callback to confirm button
      onConfirmRef.current = doCreate;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Error', message);
    }
  };

  // Preload balances for preview
  React.useEffect(() => {
    (async () => {
      const pk = await wallet.loadWallet();
      if (!pk) return;
      const bal = await connectionService.getUsdcBalance(pk);
      setWalletUsdc(bal.balance);
      const client = new BeamProgramClient(Config.solana.rpcUrl);
      const escrow = await client.getEscrowAccount(pk);
      setEscrowUsdc(escrow ? escrow.escrowBalance / 1_000_000 : 0);
      setEscrowExists(!!escrow);
    })();
  }, []);

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

      <Section title={escrowExists ? "Add funds to escrow" : "Initial escrow amount"}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Micro>USDC AMOUNT</Micro>
            <InfoButton title="What is escrow?" message="Escrow safely holds your USDC for offline payments. You can withdraw anytime." />
          </View>
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
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {['25', '50', '100', '250'].map(v => (
              <Button key={v} label={v} variant="secondary" onPress={() => setInitialAmount(v)} />
            ))}
            <Button label="Max" variant="secondary" onPress={() => walletUsdc != null ? setInitialAmount(String(Math.floor(walletUsdc))) : null} />
          </View>
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
            <Body>{escrowExists ? 'Funding escrow...' : 'Creating escrow account...'}</Body>
          </Card>
        </View>
      )}

      {/* Removed numeric keypad overlay; relying on system keyboard */}

      {/* Payment sheet */}
      <PaymentSheet
        visible={showSheet}
        title={escrowExists ? "Fund Escrow" : "Create Escrow"}
        subtitle={walletUsdc != null && escrowUsdc != null ? `Wallet ${walletUsdc.toFixed(2)} USDC → Escrow ${escrowUsdc.toFixed(2)} USDC` : (escrowExists ? 'Add funds to escrow' : 'Confirm escrow creation')}
        amountLabel={`${parseFloat(initialAmount || '0').toFixed(2)} USDC`}
        onCancel={() => setShowSheet(false)}
        onConfirm={() => onConfirmRef.current && onConfirmRef.current()}
        stage={sheetStage}
        progress={sheetProgress}
      />
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
