import React, { useMemo, useRef } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle, Animated, Easing } from 'react-native';
import { palette, radius, spacing, typography } from '../../design/tokens';
import { haptics } from '../../utils/haptics';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  labelStyle?: TextStyle;
  haptic?: boolean;
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
  haptic = true,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const scale = useRef(new Animated.Value(0)).current; // 0 -> 1.0, 1 -> 0.97

  const animatedStyle = useMemo(
    () => ({
      transform: [{
        scale: scale.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }),
      }],
    }),
    [scale]
  );

  const onPressIn = () => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 80,
      useNativeDriver: true,
      easing: Easing.out(Easing.quad),
    }).start();
  };

  const onPressOut = () => {
    Animated.timing(scale, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
      easing: Easing.out(Easing.cubic),
    }).start();
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        // Keep slight pressed transform as a fallback; animated scale handles most cases
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      onPress={isDisabled ? undefined : () => { if (haptic) haptics.light(); onPress && onPress(); }}
      onPressIn={isDisabled ? undefined : onPressIn}
      onPressOut={isDisabled ? undefined : onPressOut}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
    >
      {({ pressed: _pressed }) => (
        <Animated.View style={animatedStyle}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              {icon && (typeof icon === 'string' ? <Text>{icon}</Text> : icon)}
              <Text style={[styles.label, styles[`label_${variant}`], labelStyle]}>
                {label}
              </Text>
            </>
          )}
        </Animated.View>
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
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
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
