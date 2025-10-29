import React from 'react';
import { View, TextInput, Text, StyleSheet, ViewStyle, TextInputProps } from 'react-native';
import { DesignSystem as DS } from '../../design/system';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, helper, containerStyle, style, ...props }: InputProps) {
  const hasError = Boolean(error);
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, hasError ? styles.inputError : null, style]}
        placeholderTextColor={DS.colors.text.disabled}
        {...props}
      />
      {hasError ? (
        <Text style={styles.error}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: DS.spacing.xs },
  label: {
    color: DS.colors.text.secondary,
    fontSize: DS.typography.fontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: DS.colors.border,
    borderRadius: DS.borderRadius.md,
    paddingHorizontal: DS.spacing.md,
    paddingVertical: 12,
    color: DS.colors.text.primary,
    backgroundColor: DS.colors.background.secondary,
  },
  inputError: {
    borderColor: DS.colors.error,
  },
  error: {
    color: DS.colors.error,
    fontSize: DS.typography.fontSize.sm,
  },
  helper: {
    color: DS.colors.text.secondary,
    fontSize: DS.typography.fontSize.xs,
  },
});

