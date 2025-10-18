import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { palette, radius, spacing, typography } from '../../design/tokens';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  labelStyle?: TextStyle;
}

export function Button({
  label,
  onPress,
  loading,
  variant = 'primary',
  icon,
  disabled,
  style,
  labelStyle,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      onPress={isDisabled ? undefined : onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
    >
      {({ pressed: _pressed }) => (
        <>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              {icon}
              <Text style={[styles.label, styles[`label_${variant}`], labelStyle]}>
                {label}
              </Text>
            </>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: palette.primary,
  },
  secondary: {
    backgroundColor: 'rgba(79,70,229,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(129,140,248,0.4)',
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: typography.body,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  label_primary: {
    color: '#fff',
  },
  label_secondary: {
    color: palette.textSecondary,
  },
  label_ghost: {
    color: palette.textSecondary,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
