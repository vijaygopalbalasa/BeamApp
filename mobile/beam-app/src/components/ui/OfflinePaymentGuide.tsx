/**
 * OfflinePaymentGuide Component
 *
 * Step-by-step guide for offline QR payment exchange between customer and merchant.
 * Provides clear visual indicators, contextual help, and success/error states.
 *
 * UX IMPROVEMENTS:
 * - Visual step indicators (1 of 3, 2 of 3, etc.)
 * - Clear instructions for both customer and merchant
 * - Progress visualization
 * - Contextual help at each step
 * - Clear success/error states
 * - Accessibility support with proper labels
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { HeadingL, HeadingM, Body, Small } from './Typography';
import { Card } from './Card';
import { Button } from './Button';
import { palette, spacing, radius } from '../../design/tokens';

export type PaymentRole = 'customer' | 'merchant';
export type PaymentStep = 1 | 2 | 3 | 4;

interface StepInfo {
  title: string;
  description: string;
  action?: string;
  tip?: string;
  icon: string;
}

interface OfflinePaymentGuideProps {
  role: PaymentRole;
  currentStep: PaymentStep;
  onNext?: () => void;
  onPrevious?: () => void;
  onCancel?: () => void;
  showActions?: boolean;
}

const CUSTOMER_STEPS: Record<PaymentStep, StepInfo> = {
  1: {
    title: 'Scan Merchant QR',
    description: 'The merchant will show you a QR code with payment details (amount and their wallet address).',
    action: 'Tap "Scan QR" to open the camera and scan the merchant\'s payment request.',
    tip: 'Make sure the QR code is clearly visible and well-lit.',
    icon: '📷',
  },
  2: {
    title: 'Review & Authorize',
    description: 'Check the payment amount and merchant address. If everything looks correct, authorize the payment with biometrics.',
    action: 'Use your fingerprint or face to sign the payment bundle.',
    tip: 'Your payment is secured in escrow until the merchant confirms receipt.',
    icon: '🔐',
  },
  3: {
    title: 'Share Your Bundle QR',
    description: 'After signing, you\'ll get a QR code containing your signed payment bundle.',
    action: 'Show this QR code to the merchant so they can scan and complete the transaction.',
    tip: 'The bundle includes cryptographic proof that you authorized this payment.',
    icon: '📱',
  },
  4: {
    title: 'Settlement Complete',
    description: 'The merchant has received your payment! It will settle on-chain when you\'re both back online.',
    tip: 'You can view pending payments in your Customer Dashboard.',
    icon: '✅',
  },
};

const MERCHANT_STEPS: Record<PaymentStep, StepInfo> = {
  1: {
    title: 'Generate Payment Request',
    description: 'Enter the payment amount and generate a QR code for your customer.',
    action: 'Show the QR code to your customer so they can scan it with their Beam wallet.',
    tip: 'You can also broadcast payment requests via mesh network if enabled.',
    icon: '💰',
  },
  2: {
    title: 'Customer Scans Your QR',
    description: 'The customer will scan your QR code and authorize the payment on their device.',
    action: 'Wait for the customer to complete their authorization.',
    tip: 'This process typically takes 10-30 seconds depending on biometric authentication.',
    icon: '⏳',
  },
  3: {
    title: 'Scan Customer Bundle',
    description: 'The customer will show you their signed payment bundle QR code.',
    action: 'Tap "Scan Customer QR" to capture their payment bundle.',
    tip: 'This bundle contains cryptographic proof of their payment authorization.',
    icon: '📥',
  },
  4: {
    title: 'Payment Received',
    description: 'You\'ve successfully received the payment! It will settle on-chain when you\'re online.',
    tip: 'View all received payments in your Merchant Dashboard and settle them in batches.',
    icon: '✅',
  },
};

export function OfflinePaymentGuide({
  role,
  currentStep,
  onNext,
  onPrevious,
  onCancel,
  showActions = true,
}: OfflinePaymentGuideProps) {
  const steps = role === 'customer' ? CUSTOMER_STEPS : MERCHANT_STEPS;
  const stepInfo = steps[currentStep];
  const totalSteps = 4;
  const progressPercentage = (currentStep / totalSteps) * 100;

  return (
    <Card variant="glass" style={styles.container}>
      {/* Progress Header */}
      <View style={styles.header}>
        <View style={styles.roleContainer}>
          <Small style={styles.roleLabel}>
            {role === 'customer' ? '💸 Customer' : '💰 Merchant'} Flow
          </Small>
        </View>
        <View style={styles.stepIndicator}>
          <HeadingL style={styles.stepNumber}>{currentStep}</HeadingL>
          <Small style={styles.stepTotal}>of {totalSteps}</Small>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressBar,
              { width: `${progressPercentage}%` },
            ]}
          />
        </View>
        <View style={styles.stepDots}>
          {[1, 2, 3, 4].map(step => (
            <View
              key={step}
              style={[
                styles.stepDot,
                step <= currentStep && styles.stepDotActive,
                step === currentStep && styles.stepDotCurrent,
              ]}
            />
          ))}
        </View>
      </View>

      {/* Step Icon */}
      <View style={styles.iconContainer}>
        <View style={styles.iconCircle}>
          <HeadingL>{stepInfo.icon}</HeadingL>
        </View>
      </View>

      {/* Step Content */}
      <View style={styles.content}>
        <HeadingM style={styles.title}>{stepInfo.title}</HeadingM>
        <Body style={styles.description}>{stepInfo.description}</Body>

        {stepInfo.action && (
          <View style={styles.actionBox}>
            <Small style={styles.actionLabel}>NEXT STEP</Small>
            <Body style={styles.actionText}>{stepInfo.action}</Body>
          </View>
        )}

        {stepInfo.tip && (
          <View style={styles.tipBox}>
            <Small style={styles.tipIcon}>💡</Small>
            <Small style={styles.tipText}>{stepInfo.tip}</Small>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      {showActions && (
        <View style={styles.actions}>
          <View style={styles.buttonRow}>
            {currentStep > 1 && onPrevious && (
              <Button
                label="Previous"
                variant="ghost"
                onPress={onPrevious}
                style={styles.button}
              />
            )}
            {currentStep < totalSteps && onNext && (
              <Button
                label="Next Step"
                onPress={onNext}
                style={styles.button}
              />
            )}
            {currentStep === totalSteps && onNext && (
              <Button
                label="Done"
                onPress={onNext}
                style={styles.button}
              />
            )}
          </View>
          {onCancel && (
            <Button
              label="Cancel Payment"
              variant="ghost"
              onPress={onCancel}
              style={styles.cancelButton}
            />
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleContainer: {
    flex: 1,
  },
  roleLabel: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stepIndicator: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepNumber: {
    color: palette.accentBlue,
    fontSize: 32,
    fontWeight: '700',
  },
  stepTotal: {
    color: palette.textSecondary,
    fontSize: 12,
  },
  progressContainer: {
    gap: spacing.sm,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: palette.accentBlue,
    borderRadius: radius.sm,
  },
  stepDots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  stepDotActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.5)',
  },
  stepDotCurrent: {
    backgroundColor: palette.accentBlue,
    transform: [{ scale: 1.2 }],
  },
  iconContainer: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    gap: spacing.md,
  },
  title: {
    color: palette.textPrimary,
    textAlign: 'center',
    fontSize: 22,
  },
  description: {
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  actionBox: {
    padding: spacing.md,
    backgroundColor: 'rgba(79, 70, 229, 0.15)',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: palette.primary,
    gap: spacing.xs,
  },
  actionLabel: {
    color: palette.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  actionText: {
    color: palette.textPrimary,
    lineHeight: 22,
  },
  tipBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  tipIcon: {
    fontSize: 16,
  },
  tipText: {
    flex: 1,
    color: 'rgba(226, 232, 240, 0.9)',
    lineHeight: 18,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
  },
  cancelButton: {
    width: '100%',
  },
});
