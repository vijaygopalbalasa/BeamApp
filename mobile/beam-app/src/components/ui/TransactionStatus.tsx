/**
 * TransactionStatus Component
 *
 * Beautiful transaction progress component that shows confirmation steps
 * with estimated time remaining and transaction links.
 *
 * UX IMPROVEMENTS:
 * - Clear visual progress indicator (Submitted → Confirmed → Finalized)
 * - Estimated time remaining with countdown
 * - Transaction link for blockchain explorer
 * - Loading animations for active states
 * - Success/error states with appropriate colors
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Linking, TouchableOpacity } from 'react-native';
import { HeadingM, Body, Small } from './Typography';
import { Card } from './Card';
import { Button } from './Button';
import { palette, spacing, radius } from '../../design/tokens';

export type TransactionStep = 'submitting' | 'submitted' | 'confirming' | 'confirmed' | 'finalizing' | 'finalized' | 'failed';

interface TransactionStatusProps {
  step: TransactionStep;
  signature?: string;
  network?: 'mainnet' | 'devnet' | 'testnet';
  estimatedTimeSeconds?: number;
  onViewExplorer?: () => void;
  error?: string;
  title?: string;
  description?: string;
}

const STEP_LABELS: Record<TransactionStep, string> = {
  submitting: 'Submitting Transaction',
  submitted: 'Transaction Submitted',
  confirming: 'Confirming on Network',
  confirmed: 'Transaction Confirmed',
  finalizing: 'Finalizing',
  finalized: 'Transaction Complete',
  failed: 'Transaction Failed',
};

const STEP_DESCRIPTIONS: Record<TransactionStep, string> = {
  submitting: 'Preparing and signing your transaction...',
  submitted: 'Transaction sent to the network',
  confirming: 'Waiting for network confirmation (typically 15-30 seconds on devnet)',
  confirmed: 'Transaction confirmed by validators',
  finalizing: 'Ensuring transaction is finalized',
  finalized: 'Your transaction has been successfully processed',
  failed: 'Something went wrong with your transaction',
};

export function TransactionStatus({
  step,
  signature,
  network = 'devnet',
  estimatedTimeSeconds,
  onViewExplorer,
  error,
  title,
  description,
}: TransactionStatusProps) {
  const [countdown, setCountdown] = useState(estimatedTimeSeconds || 0);

  useEffect(() => {
    if (!estimatedTimeSeconds || step === 'finalized' || step === 'failed') {
      return;
    }

    setCountdown(estimatedTimeSeconds);
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [estimatedTimeSeconds, step]);

  const isActive = ['submitting', 'confirming', 'finalizing'].includes(step);
  const isSuccess = step === 'finalized';
  const isError = step === 'failed';

  const explorerUrl = signature
    ? `https://explorer.solana.com/tx/${signature}${network !== 'mainnet' ? `?cluster=${network}` : ''}`
    : null;

  const handleViewExplorer = () => {
    if (onViewExplorer) {
      onViewExplorer();
    } else if (explorerUrl) {
      Linking.openURL(explorerUrl).catch(err => {
        console.error('[TransactionStatus] Failed to open explorer:', err);
      });
    }
  };

  // Calculate progress (0-100)
  const getProgress = (): number => {
    switch (step) {
      case 'submitting': return 10;
      case 'submitted': return 25;
      case 'confirming': return 50;
      case 'confirmed': return 75;
      case 'finalizing': return 90;
      case 'finalized': return 100;
      case 'failed': return 0;
      default: return 0;
    }
  };

  const progress = getProgress();

  return (
    <Card variant={isError ? 'highlight' : 'glass'} style={styles.container}>
      {/* Status Icon */}
      <View style={styles.iconContainer}>
        {isActive && (
          <ActivityIndicator size="large" color={palette.accentBlue} />
        )}
        {isSuccess && (
          <View style={[styles.statusIcon, styles.successIcon]}>
            <Body style={styles.iconText}>✓</Body>
          </View>
        )}
        {isError && (
          <View style={[styles.statusIcon, styles.errorIcon]}>
            <Body style={styles.iconText}>✕</Body>
          </View>
        )}
      </View>

      {/* Title and Description */}
      <View style={styles.textContainer}>
        <HeadingM style={styles.title}>
          {title || STEP_LABELS[step]}
        </HeadingM>
        <Body style={styles.description}>
          {error || description || STEP_DESCRIPTIONS[step]}
        </Body>
      </View>

      {/* Progress Bar */}
      {!isError && (
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>
          <Small style={styles.progressText}>{progress}% complete</Small>
        </View>
      )}

      {/* Countdown Timer */}
      {isActive && countdown > 0 && (
        <View style={styles.countdownContainer}>
          <Small style={styles.countdownText}>
            Estimated time remaining: {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
          </Small>
        </View>
      )}

      {/* Transaction Signature */}
      {signature && (
        <TouchableOpacity
          style={styles.signatureContainer}
          onPress={handleViewExplorer}
          accessibilityLabel="View transaction on blockchain explorer"
          accessibilityRole="button"
        >
          <Small style={styles.signatureLabel}>Transaction Signature</Small>
          <Body style={styles.signatureValue} numberOfLines={1}>
            {signature.slice(0, 16)}...{signature.slice(-16)}
          </Body>
          <Small style={styles.signatureHint}>Tap to view on explorer</Small>
        </TouchableOpacity>
      )}

      {/* Action Buttons */}
      {(isSuccess || isError) && explorerUrl && (
        <Button
          label="View on Explorer"
          variant="secondary"
          onPress={handleViewExplorer}
          style={styles.explorerButton}
        />
      )}

      {/* Help Text for Waiting States */}
      {isActive && (
        <View style={styles.helpContainer}>
          <Small style={styles.helpText}>
            {step === 'confirming' && '💡 Tip: Devnet confirmations typically take 15-30 seconds. Your balance will update automatically.'}
            {step === 'submitting' && '🔐 Please authenticate with biometrics to sign this transaction.'}
            {step === 'finalizing' && '⏳ Almost done! Ensuring transaction is fully finalized...'}
          </Small>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: spacing.sm,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  successIcon: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  errorIcon: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  iconText: {
    fontSize: 32,
    color: palette.textPrimary,
  },
  textContainer: {
    gap: spacing.xs,
    alignItems: 'center',
    width: '100%',
  },
  title: {
    color: palette.textPrimary,
    textAlign: 'center',
  },
  description: {
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  progressContainer: {
    width: '100%',
    gap: spacing.xs,
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: palette.accentBlue,
    borderRadius: radius.sm,
  },
  progressText: {
    color: palette.textSecondary,
    textAlign: 'center',
    fontSize: 12,
  },
  countdownContainer: {
    paddingVertical: spacing.xs,
  },
  countdownText: {
    color: palette.accentBlue,
    fontWeight: '600',
    textAlign: 'center',
  },
  signatureContainer: {
    width: '100%',
    padding: spacing.md,
    backgroundColor: 'rgba(2, 6, 23, 0.6)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    gap: spacing.xs,
  },
  signatureLabel: {
    color: 'rgba(148, 163, 184, 0.7)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  signatureValue: {
    fontFamily: 'Menlo',
    fontSize: 13,
    color: palette.textPrimary,
  },
  signatureHint: {
    color: palette.accentBlue,
    fontSize: 12,
    fontStyle: 'italic',
  },
  explorerButton: {
    width: '100%',
    marginTop: spacing.xs,
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
