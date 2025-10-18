import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacing } from '../../design/tokens';
import { HeadingM, Body } from './Typography';

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function Section({ title, description, children, action }: SectionProps) {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerContent}>
          <HeadingM>{title}</HeadingM>
          {description ? <Body style={styles.description}>{description}</Body> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headerContent: {
    flex: 1,
  },
  description: {
    marginTop: spacing.xs,
  },
});
