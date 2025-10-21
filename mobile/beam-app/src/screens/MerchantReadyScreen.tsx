import React, { useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import type { BeamQRPaymentRequest } from '@beam/shared';
import { wallet } from '../wallet/WalletManager';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Body, Small } from '../components/ui/Typography';
import { spacing } from '../design/tokens';

const ONBOARDING_COMPLETE_KEY = '@beam:onboarding_complete';

interface MerchantReadyScreenProps {
  navigation: {
    navigate: (screen: string) => void;
  };
}

export function MerchantReadyScreen({ navigation }: MerchantReadyScreenProps) {
  const [qrData, setQRData] = useState<string | null>(null);
  const [merchantAddress, setMerchantAddress] = useState<string>('');

  useEffect(() => {
    void (async () => {
      const pubkey = wallet.getPublicKey();
      if (pubkey) {
        setMerchantAddress(pubkey.toBase58());
        // Generate sample QR for $10
        const qrPayload: BeamQRPaymentRequest = {
          type: 'pay',
          merchant: pubkey.toBase58(),
          amount: 10 * 1_000_000,
          currency: 'USD',
          display_amount: '10.00',
          timestamp: Date.now(),
        };
        setQRData(JSON.stringify(qrPayload));
      }
    })();
  }, []);

  const handleContinue = async () => {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    navigation.navigate('MerchantDashboard');
  };

  return (
    <Screen
      header={
        <Hero
          chip={<StatusBadge status="online" label="Ready to accept payments" icon="✅" />}
          title="You're all set!"
          subtitle="Start accepting offline payments immediately"
        />
      }
    >
      <Section
        title="How merchant mode works"
        description="Accept payments without escrow or upfront funding"
      >
        <Card>
          <Body style={styles.body}>
            ✓ Generate QR codes for any amount
            {'\n'}✓ Customers scan and pay offline
            {'\n'}✓ Receive signed payment bundles
            {'\n'}✓ Settle on-chain when convenient
            {'\n'}✓ No escrow required to receive
          </Body>
        </Card>
      </Section>

      <Section
        title="Sample payment QR"
        description="This is what a $10 payment request looks like"
      >
        {qrData && (
          <Card variant="glass" padding="lg" style={styles.qrCard}>
            <QRCode value={qrData} size={220} backgroundColor="#fff" color="#000" />
            <Small style={styles.qrHelper}>
              Customers scan this to pay you $10 USDC offline
            </Small>
          </Card>
        )}
      </Section>

      <Section
        title="Your merchant address"
        description="Customers will send payments to this address"
      >
        <Card>
          <Body selectable numberOfLines={1} style={styles.address}>
            {merchantAddress}
          </Body>
          <Small style={styles.helper}>
            All payments will be associated with this public key
          </Small>
        </Card>
      </Section>

      <Section title="Next steps">
        <Card variant="highlight">
          <Body>
            1. Generate payment QR codes from the Merchant tab
            {'\n'}2. Show QR to customers
            {'\n'}3. Receive signed payment bundles
            {'\n'}4. Settle to claim USDC when online
          </Body>
        </Card>
      </Section>

      <Section>
        <Button label="Go to merchant dashboard" onPress={handleContinue} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    color: 'rgba(148,163,184,0.9)',
  },
  qrCard: {
    alignItems: 'center',
    gap: spacing.md,
  },
  qrHelper: {
    color: 'rgba(148,163,184,0.82)',
    textAlign: 'center',
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 13,
    color: 'rgba(148,163,184,0.9)',
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
    marginTop: spacing.sm,
  },
});
