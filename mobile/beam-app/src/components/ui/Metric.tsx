import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, spacing, typography } from '../../design/tokens';

interface MetricProps {
  label: string;
  value: string;
  caption?: string;
  accent?: 'purple' | 'blue' | 'green';
}

const accentMap = {
  purple: '#A855F7',
  blue: '#38BDF8',
  green: '#22D3EE',
};

export function Metric({ label, value, caption, accent = 'purple' }: MetricProps) {
  return (
    <View style={styles.container}>
      <Text style={[styles.value, { color: accentMap[accent] }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.xs,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  label: {
    fontSize: typography.small,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  caption: {
    fontSize: typography.small,
    color: palette.textSecondary,
  },
});
