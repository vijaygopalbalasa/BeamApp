import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Linking } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { HeadingM, Body, Small, Micro } from '../components/ui/Typography';
import { transactionHistory, type TransactionItem } from '../services/TransactionHistoryService';
import { palette, spacing } from '../design/tokens';
import Clipboard from '@react-native-clipboard/clipboard';

interface Props { route: { params: { id: string } }; navigation: { goBack: () => void } }

export function TransactionDetailsScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const [tx, setTx] = useState<TransactionItem | null>(null);

  useEffect(() => {
    (async () => {
      const all = await transactionHistory.loadAll();
      setTx(all.find(i => i.id === id) || null);
    })();
  }, [id]);

  if (!tx) {
    return (
      <Screen header={<Hero title="Transaction" subtitle="Loading…" />}></Screen>
    );
  }

  const onCopy = () => { Clipboard.setString(tx.id); Alert.alert('Copied', 'Transaction ID copied'); };
  const onExplorer = () => {
    // If a signature exists, open Solana explorer (not stored here). Fallback: devnet explorer with search.
    const url = `https://explorer.solana.com/search?q=${encodeURIComponent(tx.id)}&cluster=devnet`;
    Linking.openURL(url).catch(() => Alert.alert('Cannot open explorer'));
  };

  return (
    <Screen header={<Hero title="Transaction Details" subtitle={new Date(tx.timestamp).toLocaleString()} />}>
      <View style={styles.container}>
        <Card style={styles.card}>
          <HeadingM>{tx.direction === 'in' ? 'Payment received' : 'Payment sent'}</HeadingM>
          <Body style={styles.amount}>{tx.direction === 'in' ? '+' : '-'}{tx.amount.toFixed(2)} USDC</Body>
          <View style={styles.kv}> 
            <Micro>COUNTERPARTY</Micro>
            <Body selectable>{tx.counterparty}</Body>
          </View>
          <View style={styles.kv}>
            <Micro>STATUS</Micro>
            <Small>{tx.status === 'attested' ? 'Attested' : 'Stored'}</Small>
          </View>
          <View style={styles.kv}>
            <Micro>TX ID</Micro>
            <Small selectable>{tx.id}</Small>
          </View>
          <View style={styles.row}>
            <Button label="Copy ID" onPress={onCopy} />
            <Button label="View Explorer" variant="secondary" onPress={onExplorer} />
          </View>
          <Button label="Close" variant="secondary" onPress={() => navigation.goBack()} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  card: { gap: spacing.md, padding: spacing.lg },
  amount: { color: palette.textPrimary, fontSize: 22, fontWeight: '700' },
  kv: { gap: 4 },
  row: { flexDirection: 'row', gap: spacing.sm },
});

