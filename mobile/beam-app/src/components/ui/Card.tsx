import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { palette, radius, spacing } from '../../design/tokens';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'highlight' | 'glass';
}

export function Card({ children, style, padding = 'md', variant = 'default' }: CardProps) {
  return (
    <View style={[styles.base, styles[variant], paddingStyles[padding], style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    backgroundColor: palette.card,
  },
  default: {
    backgroundColor: palette.card,
  },
  highlight: {
    backgroundColor: 'rgba(79,70,229,0.08)',
    borderColor: 'rgba(99,102,241,0.3)',
  },
  glass: {
    backgroundColor: 'rgba(15,23,42,0.65)',
    borderColor: 'rgba(148,163,184,0.1)',
  },
});

const paddingStyles = StyleSheet.create({
  none: {
    padding: 0,
  },
  sm: {
    padding: spacing.sm,
  },
  md: {
    padding: spacing.md,
  },
  lg: {
    padding: spacing.lg,
  },
});
