import React from 'react';
import { TouchableOpacity, Text, Alert, StyleSheet } from 'react-native';

interface Props {
  title: string;
  message: string;
}

export function InfoButton({ title, message }: Props) {
  return (
    <TouchableOpacity onPress={() => Alert.alert(title, message)} style={styles.btn}>
      <Text style={styles.i}>i</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  i: {
    color: 'rgba(148,163,184,0.9)',
    fontWeight: '700',
    fontSize: 12,
  },
});

