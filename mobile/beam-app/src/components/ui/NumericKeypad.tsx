import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  decimals?: number;
  showMax?: boolean;
  onMax?: () => void;
}

export function NumericKeypad({ value, onChange, onSubmit, decimals = 2, showMax, onMax }: Props) {
  const press = (ch: string) => {
    if (ch === '⌫') {
      onChange(value.slice(0, -1));
      return;
    }
    if (ch === '.' && (value.includes('.') || decimals === 0)) return;
    const next = value + ch;
    if (decimals > 0 && next.includes('.')) {
      const [, frac] = next.split('.');
      if (frac && frac.length > decimals) return;
    }
    onChange(next);
  };

  const Row = ({ children }: { children: React.ReactNode }) => (
    <View style={styles.row}>{children}</View>
  );

  const Key = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.key} onPress={onPress}>
      <Text style={styles.keyText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.grid}>
      <Row>
        <Key label="1" onPress={() => press('1')} />
        <Key label="2" onPress={() => press('2')} />
        <Key label="3" onPress={() => press('3')} />
      </Row>
      <Row>
        <Key label="4" onPress={() => press('4')} />
        <Key label="5" onPress={() => press('5')} />
        <Key label="6" onPress={() => press('6')} />
      </Row>
      <Row>
        <Key label="7" onPress={() => press('7')} />
        <Key label="8" onPress={() => press('8')} />
        <Key label="9" onPress={() => press('9')} />
      </Row>
      <Row>
        {showMax ? <Key label="Max" onPress={() => onMax?.()} /> : <View style={styles.key} />}
        <Key label="0" onPress={() => press('0')} />
        <Key label={decimals > 0 ? '.' : '⌫'} onPress={() => (decimals > 0 ? press('.') : press('⌫'))} />
      </Row>
      <Row>
        <Key label="⌫" onPress={() => press('⌫')} />
        <Key label="OK" onPress={() => onSubmit?.()} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: DS.spacing.sm },
  row: { flexDirection: 'row', gap: DS.spacing.sm },
  key: {
    flex: 1,
    height: 48,
    borderRadius: DS.borderRadius.md,
    backgroundColor: DS.colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DS.colors.border,
  },
  keyText: { color: DS.colors.text.primary, fontSize: 18, fontWeight: '600' },
});

