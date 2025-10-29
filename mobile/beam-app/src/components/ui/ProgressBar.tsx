import React from 'react';
import { View, StyleSheet } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

interface ProgressBarProps {
  value: number; // 0..1
}

export function ProgressBar({ value }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(148,163,184,0.2)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: DS.colors.primary[500],
  },
});

