import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Share } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, spacing, radius } from '../design/tokens';
import { QRCodeView } from '../components/ui/QRCodeView';
import { wallet } from '../wallet/WalletManager';
import Clipboard from '@react-native-clipboard/clipboard';

interface WalletQRScreenProps {
  navigation: { goBack: () => void };
}

export function WalletQRScreen({ navigation }: WalletQRScreenProps) {
  const [address, setAddress] = useState('');

  useEffect(() => {
    (async () => {
      const pk = wallet.getPublicKey() || (await wallet.loadWallet());
      if (pk) setAddress(pk.toBase58());
    })();
  }, []);

  const copy = () => {
    Clipboard.setString(address);
    Alert.alert('Copied', 'Wallet address copied');
  };

  const share = () => Share.share({ message: address });

  return (
    <Screen
      header={
        <Hero title="Your wallet QR" subtitle="Scan to share your Solana address" />
      }
    >
      <View style={styles.container}>
        <Card style={styles.card}>
          {address ? (
            <QRCodeView value={address} size={240} />
          ) : (
            <Body style={{ textAlign: 'center', color: palette.textSecondary }}>Loading…</Body>
          )}
          <Body selectable style={styles.address}>{address}</Body>
          <View style={styles.row}>
            <Button label="Copy" onPress={copy} />
            <Button label="Share" variant="secondary" onPress={share} />
          </View>
        </Card>
        <Button label="Close" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    alignItems: 'center',
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: palette.textPrimary,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: spacing.md,
    borderRadius: radius.sm,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
});

