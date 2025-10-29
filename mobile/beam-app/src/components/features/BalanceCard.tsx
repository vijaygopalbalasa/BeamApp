import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '../ui/Card';
import { HeadingM, Small, Body } from '../ui/Typography';
import { Skeleton } from '../ui/Skeleton';
import { DesignSystem as DS } from '../../design/system';

interface Props {
  sol: number | null;
  usdc: number | null;
  escrow: number;
  loading?: boolean;
  updatedAt?: number;
  onRefresh?: () => void;
  refreshButton?: React.ReactNode;
}

export function BalanceCard({ sol, usdc, escrow, loading, updatedAt, refreshButton }: Props) {
  return (
    <Card variant="glass" style={styles.card}>
      <Small style={styles.label}>Available Balance</Small>
      {loading ? (
        <View style={{ gap: 12 }}>
          <Skeleton height={14} width={120} style={{ alignSelf: 'center' }} />
          <View style={styles.row}>
            <View style={styles.item}><Skeleton height={22} width={140} /></View>
            <View style={styles.divider} />
            <View style={styles.item}><Skeleton height={22} width={120} /></View>
          </View>
          <Skeleton height={16} width={'90%'} style={{ alignSelf: 'center', borderRadius: 10 }} />
        </View>
      ) : (
        <View>
          <View style={styles.row}>
            <View style={styles.item}>
              <HeadingM style={styles.amount}>{sol != null ? sol.toFixed(4) : '0.0000'} SOL</HeadingM>
            </View>
            <View style={styles.divider} />
            <View style={styles.item}>
              <HeadingM style={styles.amount}>{usdc != null ? usdc.toFixed(2) : '0.00'} USDC</HeadingM>
            </View>
          </View>
          <View style={styles.escrowBox}>
            <Small style={styles.escrowLabel}>Escrow</Small>
            <Body style={styles.escrowValue}>🔒 {escrow.toFixed(2)} USDC</Body>
          </View>
        </View>
      )}
      {refreshButton}
      {updatedAt ? (
        <Small style={styles.updated}>Updated {Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))}s ago</Small>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: DS.spacing.lg, gap: DS.spacing.md },
  label: { color: DS.colors.text.secondary, textAlign: 'center' },
  loading: { color: DS.colors.text.secondary, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: DS.spacing.sm },
  item: { flex: 1, alignItems: 'center' },
  divider: { width: 1, height: 40, backgroundColor: 'rgba(148,163,184,0.2)' },
  amount: { color: DS.colors.text.primary, fontSize: 18 },
  escrowBox: { marginTop: DS.spacing.md, padding: DS.spacing.md, backgroundColor: 'rgba(99,102,241,0.1)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(99,102,241,0.2)' },
  escrowLabel: { color: DS.colors.text.secondary, fontSize: 12 },
  escrowValue: { color: DS.colors.primary[500], fontSize: 16, fontWeight: '600' },
  updated: { marginTop: DS.spacing.xs, color: 'rgba(148,163,184,0.7)', textAlign: 'center' },
});
