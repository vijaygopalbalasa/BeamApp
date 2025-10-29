import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  label: string;
  variant?: Variant;
}

export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  return (
    <View style={[styles.base, styles[variant]]}>
      <Text style={[styles.text, styles[`text_${variant}`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: DS.spacing.sm,
    paddingVertical: 4,
    borderRadius: DS.borderRadius.full,
  },
  text: {
    fontSize: DS.typography.fontSize.xs,
    fontWeight: '600',
  },
  success: { backgroundColor: 'rgba(16,185,129,0.15)' },
  warning: { backgroundColor: 'rgba(245,158,11,0.15)' },
  error: { backgroundColor: 'rgba(239,68,68,0.15)' },
  info: { backgroundColor: 'rgba(56,189,248,0.15)' },
  neutral: { backgroundColor: 'rgba(148,163,184,0.15)' },
  text_success: { color: DS.colors.success },
  text_warning: { color: DS.colors.warning },
  text_error: { color: DS.colors.error },
  text_info: { color: DS.colors.info },
  text_neutral: { color: DS.colors.text.secondary },
});

