import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DesignSystem as DS } from '../../design/system';
import type { TransactionItem } from '../../services/TransactionHistoryService';

interface Props {
  item: TransactionItem;
  onPress?: (id: string) => void;
}

export function TransactionCard({ item, onPress }: Props) {
  const icon = item.direction === 'in' ? '↓' : '↑';
  const amountColor = item.direction === 'in' ? DS.colors.success : DS.colors.text.primary;
  const statusDot = item.status === 'attested' ? '●' : '○';
  const date = new Date(item.timestamp).toLocaleString();
  const cp = item.counterparty.length > 10 ? `${item.counterparty.slice(0, 6)}…${item.counterparty.slice(-6)}` : item.counterparty;
  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress?.(item.id)}>
      <View style={styles.icon}><Text style={styles.iconText}>{icon}</Text></View>
      <View style={styles.content}>
        <Text style={styles.title}>{item.direction === 'in' ? 'Received' : 'Paid'}</Text>
        <Text style={styles.subtitle}>{cp}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={[styles.amount, { color: amountColor }]}>{item.direction === 'in' ? '+' : '-'}{item.amount.toFixed(2)} USDC</Text>
        <Text style={styles.time}>{date}  {statusDot}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.colors.border,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(148,163,184,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: DS.colors.text.secondary, fontWeight: '700' },
  content: { flex: 1 },
  title: { color: DS.colors.text.primary, fontWeight: '600' },
  subtitle: { color: DS.colors.text.secondary, fontSize: 12 },
  meta: { alignItems: 'flex-end', gap: 2 },
  amount: { fontWeight: '700' },
  time: { color: DS.colors.text.secondary, fontSize: 11 },
});

