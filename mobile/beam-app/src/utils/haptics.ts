import { Vibration, Platform } from 'react-native';

/**
 * Haptic feedback utilities with robust error handling.
 * Vibration API can fail on some devices/configurations, so we wrap all calls in try-catch.
 */
export const haptics = {
  light() {
    try {
      // Short vibration as a stand-in for haptic tap
      Vibration.vibrate(10);
    } catch (error) {
      // Silently fail - haptics are non-critical UX enhancement
      if (__DEV__) {
        console.log('[Haptics] Light vibration failed:', error);
      }
    }
  },
  success() {
    try {
      if (Platform.OS === 'android') {
        Vibration.vibrate([0, 20, 30, 20]);
      } else {
        Vibration.vibrate(30);
      }
    } catch (error) {
      // Silently fail - haptics are non-critical UX enhancement
      if (__DEV__) {
        console.log('[Haptics] Success vibration failed:', error);
      }
    }
  },
  error() {
    try {
      Vibration.vibrate([0, 30, 40, 30]);
    } catch (error) {
      // Silently fail - haptics are non-critical UX enhancement
      if (__DEV__) {
        console.log('[Haptics] Error vibration failed:', error);
      }
    }
  },
};

