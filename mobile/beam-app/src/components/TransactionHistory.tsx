import React from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Card } from './ui/Card';
import { Section } from './ui/Section';
import { HeadingM, Body, Small } from './ui/Typography';
import { StatusBadge } from './ui/StatusBadge';
import { palette, spacing, radius } from '../design/tokens';
import type { BundleHistoryEntry } from '../solana/types';

interface TransactionHistoryProps {
  transactions: BundleHistoryEntry[];
  onTransactionPress?: (tx: BundleHistoryEntry) => void;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  onTransactionPress,
}) => {
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000); // Convert from Unix timestamp
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatAmount = (amount: number) => {
    return (amount / 1_000_000).toFixed(2);
  };

  const renderTransaction = ({ item: tx }: { item: BundleHistoryEntry }) => {
    const merchantShort = `${tx.merchant.toBase58().substring(0, 4)}...${tx.merchant.toBase58().substring(tx.merchant.toBase58().length - 4)}`;

    return (
      <TouchableOpacity
        onPress={() => onTransactionPress?.(tx)}
        activeOpacity={0.7}
      >
        <Card variant="subtle" padding="md" style={styles.transactionCard}>
          <View style={styles.transactionHeader}>
            <View style={styles.transactionInfo}>
              <HeadingM style={styles.amount}>
                ${formatAmount(tx.amount)} USDC
              </HeadingM>
              <Small style={styles.merchant}>→ {merchantShort}</Small>
            </View>
            <StatusBadge status="online" label="Settled" icon="✓" />
          </View>

          <View style={styles.transactionDetails}>
            <View style={styles.detailRow}>
              <Small style={styles.detailLabel}>Nonce</Small>
              <Small style={styles.detailValue}>#{tx.nonce.toString()}</Small>
            </View>

            <View style={styles.detailRow}>
              <Small style={styles.detailLabel}>Bundle Hash</Small>
              <Small style={styles.detailValue} numberOfLines={1} ellipsizeMode="middle">
                {tx.bundleHash.substring(0, 16)}...
              </Small>
            </View>

            <View style={styles.detailRow}>
              <Small style={styles.detailLabel}>Settled</Small>
              <Small style={styles.detailValue}>{formatTimestamp(tx.settledAt)}</Small>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <Section
      title="Transaction History"
      description={`${transactions.length} settlement${transactions.length !== 1 ? 's' : ''} on-chain`}
    >
      {transactions.length === 0 ? (
        <Card variant="glass" padding="lg" style={styles.emptyState}>
          <Body style={styles.emptyIcon}>📜</Body>
          <Body style={styles.emptyText}>No transactions yet</Body>
          <Small style={styles.emptyHint}>
            Your settled payments will appear here
          </Small>
        </Card>
      ) : (
        <FlatList
          data={transactions}
          renderItem={renderTransaction}
          keyExtractor={(item, index) => `${item.bundleHash}-${index}`}
          contentContainerStyle={styles.listContainer}
          scrollEnabled={false}
        />
      )}
    </Section>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    gap: spacing.sm,
  },
  transactionCard: {
    marginBottom: spacing.xs,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  transactionInfo: {
    flex: 1,
  },
  amount: {
    color: palette.textPrimary,
    marginBottom: 2,
  },
  merchant: {
    color: palette.textSecondary,
    fontFamily: 'monospace',
  },
  transactionDetails: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.1)',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: palette.textSecondary,
  },
  detailValue: {
    color: palette.textPrimary,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyHint: {
    color: palette.textSecondary,
    textAlign: 'center',
  },
});
