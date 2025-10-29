export const palette = {
  primary: '#4F46E5',
  primaryDark: '#3730A3',
  primarySoft: '#EEF2FF',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  neutral: '#64748B',
  surface: '#0F172A',
  background: '#020617',
  card: '#111827',
  cardSoft: '#1E293B',
  border: '#1E293B',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5F5',
  textMuted: '#7E8B9F', // Improved from #64748B for better WCAG AA compliance (4.5:1 contrast)
  accentBlue: '#38BDF8',
  accentPurple: '#A855F7',
  accentGreen: '#22D3EE',
};

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
};

export const typography = {
  headingXL: 32,
  headingL: 24,
  headingM: 20,
  body: 16,
  small: 14,
  micro: 13, // Improved from 12 for better readability (minimum recommended is 13px)
};

// Line heights for better readability
export const lineHeights = {
  headingXL: 40,
  headingL: 32,
  headingM: 28,
  body: 24, // 1.5x line height
  small: 20, // 1.43x line height
  micro: 18, // 1.38x line height
};

// Minimum touch target size for accessibility (iOS/Android HIG)
export const touchTargets = {
  minimum: 44, // 44pt minimum for iOS, 48dp for Android (we use 44 as baseline)
  recommended: 48,
  comfortable: 56,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
};

export const layout = {
  maxContentWidth: 480,
};
