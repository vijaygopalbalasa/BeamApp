/**
 * ErrorBoundary Component
 *
 * Graceful error handling with user-friendly messages and recovery actions.
 * Catches React component errors and provides helpful feedback.
 *
 * UX IMPROVEMENTS:
 * - User-friendly error messages instead of crash screens
 * - Recovery actions (retry, go home, refresh)
 * - Error reporting capability
 * - Maintains app state where possible
 * - Accessibility support
 */

import React, { Component, ReactNode } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { HeadingL, HeadingM, Body, Small } from './Typography';
import { Card } from './Card';
import { Button } from './Button';
import { palette, spacing, radius } from '../../design/tokens';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to error reporting service
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    this.setState({
      errorInfo,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    this.props.onReset?.();
  };

  getUserFriendlyMessage(error: Error | null): string {
    if (!error) {
      return 'An unexpected error occurred.';
    }

    const message = error.message.toLowerCase();

    // Network errors
    if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      return 'Unable to connect to the network. Please check your internet connection and try again.';
    }

    // Wallet errors
    if (message.includes('wallet') || message.includes('keypair') || message.includes('signature')) {
      return 'There was a problem with your wallet. Please make sure your wallet is set up correctly.';
    }

    // Biometric errors
    if (message.includes('biometric') || message.includes('authentication')) {
      return 'Biometric authentication failed. Please try again or check your device settings.';
    }

    // Transaction errors
    if (message.includes('transaction') || message.includes('confirm')) {
      return 'Transaction failed. Please try again or check your balance and network connection.';
    }

    // Storage errors
    if (message.includes('storage') || message.includes('async')) {
      return 'Unable to access secure storage. Please restart the app and try again.';
    }

    // Generic error
    return 'Something went wrong. Please try again.';
  }

  getRecoveryActions(error: Error | null): Array<{ label: string; action: () => void; variant?: 'primary' | 'secondary' | 'ghost' }> {
    const actions: Array<{ label: string; action: () => void; variant?: 'primary' | 'secondary' | 'ghost' }> = [
      {
        label: 'Try Again',
        action: this.handleReset,
        variant: 'primary',
      },
    ];

    const message = error?.message.toLowerCase() || '';

    // Add specific recovery actions based on error type
    if (message.includes('network') || message.includes('timeout')) {
      actions.push({
        label: 'Check Network Settings',
        action: () => {
          // Could open device network settings
          this.handleReset();
        },
        variant: 'secondary',
      });
    }

    if (message.includes('wallet')) {
      actions.push({
        label: 'Reset Wallet',
        action: () => {
          // Could navigate to wallet setup
          this.handleReset();
        },
        variant: 'secondary',
      });
    }

    return actions;
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const userMessage = this.getUserFriendlyMessage(this.state.error);
      const actions = this.getRecoveryActions(this.state.error);

      return (
        <View style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Card variant="glass" style={styles.errorCard}>
              {/* Error Icon */}
              <View style={styles.iconContainer}>
                <View style={styles.iconCircle}>
                  <HeadingL style={styles.iconText}>⚠️</HeadingL>
                </View>
              </View>

              {/* Error Message */}
              <View style={styles.messageContainer}>
                <HeadingM style={styles.title}>Oops! Something went wrong</HeadingM>
                <Body style={styles.message}>{userMessage}</Body>
              </View>

              {/* Recovery Actions */}
              <View style={styles.actionsContainer}>
                {actions.map((action, index) => (
                  <Button
                    key={index}
                    label={action.label}
                    variant={action.variant || 'primary'}
                    onPress={action.action}
                    style={styles.actionButton}
                  />
                ))}
              </View>

              {/* Technical Details (Dev Mode Only) */}
              {__DEV__ && this.state.error && (
                <View style={styles.technicalContainer}>
                  <Small style={styles.technicalLabel}>Technical Details (Dev Only)</Small>
                  <Card variant="glass" style={styles.technicalCard}>
                    <Small style={styles.technicalText}>
                      {this.state.error.name}: {this.state.error.message}
                    </Small>
                    {this.state.errorInfo && (
                      <Small style={styles.technicalText}>
                        {this.state.errorInfo.componentStack}
                      </Small>
                    )}
                  </Card>
                </View>
              )}

              {/* Help Text */}
              <View style={styles.helpContainer}>
                <Small style={styles.helpText}>
                  💡 If this problem persists, try restarting the app or checking your network connection.
                </Small>
              </View>
            </Card>
          </ScrollView>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorCard: {
    gap: spacing.xl,
    padding: spacing.xl,
  },
  iconContainer: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 48,
  },
  messageContainer: {
    gap: spacing.md,
    alignItems: 'center',
  },
  title: {
    color: palette.textPrimary,
    textAlign: 'center',
    fontSize: 22,
  },
  message: {
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  actionsContainer: {
    gap: spacing.sm,
    width: '100%',
  },
  actionButton: {
    width: '100%',
  },
  technicalContainer: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  technicalLabel: {
    color: palette.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  technicalCard: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  technicalText: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: 'rgba(239, 68, 68, 0.9)',
    lineHeight: 16,
  },
  helpContainer: {
    width: '100%',
    padding: spacing.md,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: palette.accentBlue,
  },
  helpText: {
    color: 'rgba(226, 232, 240, 0.9)',
    lineHeight: 18,
  },
});
