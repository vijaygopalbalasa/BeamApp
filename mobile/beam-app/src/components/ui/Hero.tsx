import React from 'react';
import { View, StyleSheet } from 'react-native';
import { palette, radius, spacing } from '../../design/tokens';
import { HeadingXL, Body } from './Typography';

interface HeroProps {
  title: string;
  subtitle?: string;
  chip?: React.ReactNode;
  right?: React.ReactNode;
}

export function Hero({ title, subtitle, chip, right }: HeroProps) {
  return (
    <View style={styles.outer}>
      <View style={styles.glow} />
      <View style={styles.container}>
        <View style={styles.leftColumn}>
          {chip}
          <HeadingXL>{title}</HeadingXL>
          {subtitle ? <Body style={styles.subtitle}>{subtitle}</Body> : null}
        </View>
        {right ? <View style={styles.rightColumn}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.primary,
    opacity: 0.4,
  },
  container: {
    backgroundColor: 'rgba(17,24,39,0.92)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.4)',
    padding: spacing.lg,
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
  },
  leftColumn: {
    flex: 1,
    gap: spacing.sm,
  },
  rightColumn: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  subtitle: {
    marginTop: spacing.xs,
  },
});
