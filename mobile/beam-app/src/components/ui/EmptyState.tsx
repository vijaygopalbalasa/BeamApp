import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

interface Props {
  title: string;
  subtitle?: string;
}

export function EmptyState({ title, subtitle }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: DS.spacing.xs, padding: DS.spacing.lg },
  title: { color: DS.colors.text.secondary, fontWeight: '600' },
  subtitle: { color: DS.colors.text.secondary, opacity: 0.8, fontSize: 12, textAlign: 'center' },
});

