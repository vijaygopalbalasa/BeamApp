// Professional design system built on top of existing tokens
import { palette as basePalette, spacing as baseSpacing, radius as baseRadius, typography as baseType, lineHeights } from './tokens';

export const DesignSystem = {
  colors: {
    primary: {
      50: '#EEF2FF',
      500: basePalette.primary,
      900: basePalette.primaryDark,
    },
    success: basePalette.success,
    warning: basePalette.warning,
    error: basePalette.danger,
    info: basePalette.accentBlue,
    background: {
      primary: basePalette.background,
      secondary: basePalette.surface,
      elevated: basePalette.card,
    },
    text: {
      primary: basePalette.textPrimary,
      secondary: basePalette.textSecondary,
      disabled: basePalette.textMuted,
    },
    border: basePalette.border,
  },
  typography: {
    fontFamily: {
      regular: 'System',
      medium: 'System',
      semibold: 'System',
      bold: 'System',
    },
    fontSize: {
      xs: 12,
      sm: baseType.small,
      base: baseType.body,
      lg: baseType.headingM,
      xl: baseType.headingL,
      '2xl': baseType.headingXL,
      '3xl': 36,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
      tokens: lineHeights,
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: baseSpacing.md,
    lg: baseSpacing.lg,
    xl: baseSpacing.xl,
    '2xl': baseSpacing.xxl,
  },
  borderRadius: {
    sm: baseRadius.sm,
    md: baseRadius.md,
    lg: baseRadius.lg,
    xl: 28,
    full: 9999,
  },
  shadows: {
    sm: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    md: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
    lg: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  },
  animations: {
    duration: {
      fast: 150,
      normal: 250,
      slow: 400,
    },
    easing: {
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },
} as const;

