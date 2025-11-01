import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import type { OfflineBundle } from '@beam/shared';
import { Card } from '../ui/Card';
import { HeadingM, Small, Body } from '../ui/Typography';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { palette, spacing, radius } from '../../design/tokens';
import { BundleState } from '../../storage/BundleTransactionManager';

export interface PendingBundleListItem {
  bundle: OfflineBundle;
  state?: BundleState;
  updatedAt?: number;
  error?: string;
}

interface PendingBundleListProps {
  items: PendingBundleListItem[];
  onRetry?: (item: PendingBundleListItem) => void;
  onRemove?: (item: PendingBundleListItem) => void;
}

export function PendingBundleList({ items, onRetry, onRemove }: PendingBundleListProps) {
  const keyExtractor = useCallback((item: PendingBundleListItem) => item.bundle.tx_id, []);

  const renderSeparator = useCallback(() => <View style={styles.separator} />, []);

  const renderItem = useCallback<ListRenderItem<PendingBundleListItem>>(
    ({ item }) => <PendingBundleCard item={item} onRetry={onRetry} onRemove={onRemove} />,
    [onRemove, onRetry],
  );

  if (items.length === 0) {
    return (
      <Card variant="glass" padding="lg" style={styles.emptyCard}>
        <HeadingM style={styles.emptyTitle}>No pending bundles</HeadingM>
        <Small style={styles.emptyText}>
          Create an offline payment while you’re away from the network. Bundles show here until they reach the merchant or settle on-chain.
        </Small>
      </Card>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={keyExtractor}
      ItemSeparatorComponent={renderSeparator}
      renderItem={renderItem}
    />
  );
}

function PendingBundleCard({ item, onRetry, onRemove }: {
  item: PendingBundleListItem;
  onRetry?: (item: PendingBundleListItem) => void;
  onRemove?: (item: PendingBundleListItem) => void;
}) {
  const { bundle, state, updatedAt, error } = item;
  const amount = bundle.token?.amount ? bundle.token.amount / 1_000_000 : 0;
  const timestamp = new Date(updatedAt ?? bundle.timestamp).toLocaleString();

  const status = buildStatus(state, error);

  return (
    <Card variant="glass" padding="md" style={styles.bundleCard}>
      <View style={styles.bundleHeader}>
        <HeadingM style={styles.bundleTitle}>Bundle {bundle.tx_id.slice(0, 6)}…</HeadingM>
        <Small style={styles.bundleTimestamp}>{timestamp}</Small>
      </View>

      <StatusBadge label={status.label} status={status.status} icon={status.icon} />

      <View style={styles.bundleRow}>
        <Small style={styles.bundleLabel}>Merchant</Small>
        <Body style={styles.bundleValue}>{bundle.merchant_pubkey.slice(0, 8)}…{bundle.merchant_pubkey.slice(-6)}</Body>
      </View>

      <View style={styles.bundleRow}>
        <Small style={styles.bundleLabel}>Amount</Small>
        <Body style={styles.bundleValue}>${amount.toFixed(2)} {bundle.token?.symbol ?? 'USDC'}</Body>
      </View>

      {error ? (
        <Small style={styles.errorText}>⚠️ {error}</Small>
      ) : null}

      {(onRetry || onRemove) ? (
        <View style={styles.actions}>
          {onRetry ? (
            <Button
              label="Retry delivery"
              icon="🔁"
              variant="secondary"
              onPress={() => onRetry(item)}
              style={styles.retryButton}
            />
          ) : null}
          {onRemove ? (
            <Button
              label="Remove"
              icon="🗑️"
              variant="ghost"
              onPress={() => onRemove(item)}
              style={styles.removeButton}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function buildStatus(state?: BundleState, error?: string): { label: string; status: 'online' | 'offline' | 'degraded' | 'pending'; icon?: string } {
  if (error) {
    return { label: 'Error', status: 'degraded', icon: '⚠️' };
  }

  switch (state) {
    case BundleState.ATTESTED:
      return { label: 'Attested', status: 'pending', icon: '🔐' };
    case BundleState.QUEUED:
      return { label: 'Queued', status: 'pending', icon: '📦' };
    case BundleState.BROADCAST:
      return { label: 'Delivered', status: 'online', icon: '📡' };
    case BundleState.SETTLED:
      return { label: 'Settled', status: 'online', icon: '✅' };
    case BundleState.FAILED:
      return { label: 'Failed', status: 'degraded', icon: '⚠️' };
    case BundleState.ROLLBACK:
      return { label: 'Rolled back', status: 'degraded', icon: '♻️' };
    case BundleState.PENDING:
    default:
      return { label: 'Pending', status: 'pending', icon: '🕒' };
  }
}

const styles = StyleSheet.create({
  separator: {
    height: spacing.sm,
  },
  emptyCard: {
    gap: spacing.sm,
    borderRadius: radius.md,
  },
  emptyTitle: {
    color: palette.textPrimary,
  },
  emptyText: {
    color: palette.textSecondary,
  },
  bundleCard: {
    gap: spacing.sm,
  },
  bundleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bundleTitle: {
    color: palette.textPrimary,
    fontSize: 16,
  },
  bundleTimestamp: {
    color: palette.textSecondary,
  },
  bundleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bundleLabel: {
    color: palette.textSecondary,
  },
  bundleValue: {
    color: palette.textPrimary,
    fontWeight: '600',
  },
  errorText: {
    color: palette.textSecondary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  retryButton: {
    flex: 1,
  },
  removeButton: {
    flex: 1,
  },
});
