import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

interface Props {
  online: boolean;
  program: boolean;
  updatedAt?: number;
}

export function NetworkStatus({ online, program, updatedAt }: Props) {
  const seconds = updatedAt ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)) : null;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: online ? DS.colors.success : DS.colors.error }]} />
      <Text style={styles.text}>Network: {online ? 'Online' : 'Offline'}</Text>
      <View style={[styles.dot, { backgroundColor: program ? DS.colors.success : DS.colors.warning }]} />
      <Text style={styles.text}>Program: {program ? 'Found' : 'Missing'}</Text>
      <Text style={[styles.text, { marginLeft: 'auto' }]}>
        {seconds != null ? `Updated ${seconds}s ago` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    color: DS.colors.text.secondary,
    fontSize: 12,
  },
});

