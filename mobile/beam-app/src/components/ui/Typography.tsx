import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { palette, typography } from '../../design/tokens';

interface TypographyProps extends TextProps {
  children: React.ReactNode;
}

function createTextComponent(style: object) {
  return function Component({ style: styleOverride, children, ...rest }: TypographyProps) {
    return (
      <Text style={[styles.baseText, style, styleOverride]} {...rest}>
        {children}
      </Text>
    );
  };
}

const styles = StyleSheet.create({
  baseText: {
    color: palette.textPrimary,
  },
  headingXL: {
    fontSize: typography.headingXL,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headingL: {
    fontSize: typography.headingL,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  headingM: {
    fontSize: typography.headingM,
    fontWeight: '600',
  },
  body: {
    fontSize: typography.body,
    color: palette.textSecondary,
    lineHeight: typography.body * 1.5,
  },
  small: {
    fontSize: typography.small,
    color: palette.textSecondary,
  },
  micro: {
    fontSize: typography.micro,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

export const HeadingXL = createTextComponent(styles.headingXL);
export const HeadingL = createTextComponent(styles.headingL);
export const HeadingM = createTextComponent(styles.headingM);
export const Body = createTextComponent(styles.body);
export const Small = createTextComponent(styles.small);
export const Micro = createTextComponent(styles.micro);
