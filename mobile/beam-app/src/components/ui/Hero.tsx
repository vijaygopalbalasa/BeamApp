import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { palette, radius, spacing } from '../../design/tokens';
import { HeadingXL, Body } from './Typography';

interface HeroProps {
  title: string;
  subtitle?: string;
  chip?: React.ReactNode;
  right?: React.ReactNode;
}

export function Hero({ title, subtitle, chip, right }: HeroProps) {
  const { width } = useWindowDimensions();
  // Use column layout on mobile (most phones are 360-430px wide)
  // Use row layout on tablets/desktop (>700px)
  const isSmallScreen = width < 700;

  return (
    <View style={styles.outer}>
      <View style={styles.glow} />
      <View style={[styles.container, isSmallScreen && styles.containerSmall]}>
        <View style={styles.leftColumn}>
          {chip}
          <HeadingXL>{title}</HeadingXL>
          {subtitle ? <Body style={styles.subtitle}>{subtitle}</Body> : null}
        </View>
        {right ? <View style={[styles.rightColumn, isSmallScreen && styles.rightColumnSmall]}>{right}</View> : null}
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
    alignItems: 'flex-start',
  },
  containerSmall: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  leftColumn: {
    flex: 1,
    gap: spacing.sm,
  },
  rightColumn: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  rightColumnSmall: {
    width: '100%',
    alignItems: 'stretch',
  },
  subtitle: {
    marginTop: spacing.xs,
  },
});
