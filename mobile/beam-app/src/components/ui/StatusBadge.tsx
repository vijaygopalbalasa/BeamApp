import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, radius, spacing, typography } from '../../design/tokens';

interface StatusBadgeProps {
  label: string;
  status: 'online' | 'offline' | 'degraded' | 'pending';
  icon?: string;
}

const statusColors: Record<StatusBadgeProps['status'], { bg: string; dot: string }> = {
  online: { bg: 'rgba(16,185,129,0.15)', dot: '#10B981' },
  offline: { bg: 'rgba(239,68,68,0.15)', dot: '#EF4444' },
  degraded: { bg: 'rgba(245,158,11,0.18)', dot: '#F59E0B' },
  pending: { bg: 'rgba(56,189,248,0.16)', dot: '#38BDF8' },
};

export function StatusBadge({ label, status, icon }: StatusBadgeProps) {
  const colors = statusColors[status];
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.dot, { backgroundColor: colors.dot }]} />
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 1.5,
    gap: spacing.xs / 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  icon: {
    fontSize: typography.small,
  },
  label: {
    fontSize: typography.small,
    color: palette.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
