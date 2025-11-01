import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItem } from 'react-native';
import type { OfflineBundle } from '@beam/shared';
import { Card } from '../ui/Card';
import { HeadingM, Small, Body } from '../ui/Typography';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { palette, spacing, radius } from '../../design/tokens';
import { BundleState } from '../../storage/BundleTransactionManager';

export interface ReceivedBundleListItem {
  bundle: OfflineBundle;
  state?: BundleState;
  updatedAt?: number;
  error?: string;
}

interface ReceivedBundleListProps {
  items: ReceivedBundleListItem[];
  onReport?: (item: ReceivedBundleListItem) => void;
  onShare?: (item: ReceivedBundleListItem) => void;
  onRemove?: (item: ReceivedBundleListItem) => void;
}

export function ReceivedBundleList({ items, onReport, onShare, onRemove }: ReceivedBundleListProps) {
  const keyExtractor = useCallback((item: ReceivedBundleListItem) => item.bundle.tx_id, []);
  const renderSeparator = useCallback(() => <View style={styles.separator} />, []);
  const renderItem = useCallback<ListRenderItem<ReceivedBundleListItem>>(
    ({ item }) => (
      <ReceivedBundleCard
        item={item}
        onReport={onReport}
        onShare={onShare}
        onRemove={onRemove}
      />
    ),
    [onReport, onShare, onRemove],
  );

  if (items.length === 0) {
    return (
      <Card variant="glass" padding="lg" style={styles.emptyCard}>
        <HeadingM style={styles.emptyTitle}>No bundles received yet</HeadingM>
        <Small style={styles.emptyText}>
          When customers deliver offline payments, they’ll appear here with the amount and payer details.
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

function ReceivedBundleCard({
  item,
  onReport,
  onShare,
  onRemove,
}: {
  item: ReceivedBundleListItem;
  onReport?: (item: ReceivedBundleListItem) => void;
  onShare?: (item: ReceivedBundleListItem) => void;
  onRemove?: (item: ReceivedBundleListItem) => void;
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
        <Small style={styles.bundleLabel}>Payer</Small>
        <Body style={styles.bundleValue}>{bundle.payer_pubkey.slice(0, 8)}…{bundle.payer_pubkey.slice(-6)}</Body>
      </View>

      <View style={styles.bundleRow}>
        <Small style={styles.bundleLabel}>Amount</Small>
        <Body style={styles.bundleValue}>${amount.toFixed(2)} {bundle.token?.symbol ?? 'USDC'}</Body>
      </View>

      {error ? (
        <Small style={styles.errorText}>⚠️ {error}</Small>
      ) : null}

      {(onReport || onShare || onRemove) ? (
        <View style={styles.actions}>
          {onShare ? (
            <Button
              label="Show fallback QR"
              icon="📲"
              variant="secondary"
              onPress={() => onShare(item)}
              style={styles.actionButton}
            />
          ) : null}
          {onReport ? (
            <Button
              label="Report issue"
              icon="🚨"
              variant="primary"
              onPress={() => onReport(item)}
              style={styles.actionButton}
            />
          ) : null}
          {onRemove ? (
            <Button
              label="Remove"
              icon="🗑️"
              variant="ghost"
              onPress={() => onRemove(item)}
              style={styles.actionButton}
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
      return { label: 'Ready to settle', status: 'pending', icon: '📬' };
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
    flexWrap: 'wrap',
  },
  actionButton: {
    flexGrow: 1,
  },
});
