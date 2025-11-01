import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card } from '../ui/Card';
import { HeadingM, Body, Small } from '../ui/Typography';
import { Button } from '../ui/Button';
import { palette, radius, spacing } from '../../design/tokens';

export type PaymentWizardStep = 'scan' | 'connecting' | 'confirm' | 'broadcast' | 'complete' | 'failed';

interface Action {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}

interface Props {
  step: PaymentWizardStep;
  merchantName?: string;
  amountLabel?: string;
  tips?: string[];
  primaryAction?: Action;
  secondaryAction?: Action;
}

const copy: Record<PaymentWizardStep, { title: string; subtitle: string }> = {
  scan: {
    title: 'Ready to scan',
    subtitle: 'Tap “Scan merchant QR” to start a payment.',
  },
  connecting: {
    title: 'Connecting…',
    subtitle: 'Keep both devices close while Beam establishes Bluetooth.',
  },
  confirm: {
    title: 'Review and confirm',
    subtitle: 'Verify the amount and merchant before sending.',
  },
  broadcast: {
    title: 'Sending bundle…',
    subtitle: 'Stay on this screen until the transfer completes.',
  },
  complete: {
    title: 'Payment sent',
    subtitle: 'The merchant now has your bundle and can sign when online.',
  },
  failed: {
    title: 'Delivery failed',
    subtitle: 'Retry the Bluetooth transfer or share the fallback QR.',
  },
};

export function PaymentFlowWizard({
  step,
  merchantName,
  amountLabel,
  tips,
  primaryAction,
  secondaryAction,
}: Props) {
  const { title, subtitle } = copy[step];
  const defaultTips = tips ?? buildDefaultTips(step);

  return (
    <Card variant="glass" padding="lg" style={styles.card}>
      <View style={styles.header}>
        <HeadingM>{title}</HeadingM>
        <Body style={styles.subtitle}>{subtitle}</Body>
        {merchantName ? <Body style={styles.detail}>Merchant: {merchantName}</Body> : null}
        {amountLabel ? <Body style={styles.detail}>Amount: {amountLabel}</Body> : null}
      </View>

      <View style={styles.tips}>
        {defaultTips.map((tip, idx) => (
          <View key={idx} style={styles.tipRow}>
            <Small style={styles.bullet}>•</Small>
            <Small style={styles.tip}>{tip}</Small>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        {secondaryAction ? (
          <Button
            label={secondaryAction.label}
            onPress={secondaryAction.onPress}
            variant={secondaryAction.variant ?? 'ghost'}
            style={styles.button}
            disabled={secondaryAction.disabled}
          />
        ) : null}
        {primaryAction ? (
          <Button
            label={primaryAction.label}
            onPress={primaryAction.onPress}
            variant={primaryAction.variant ?? 'primary'}
            style={styles.button}
            disabled={primaryAction.disabled}
          />
        ) : null}
      </View>
    </Card>
  );
}

function buildDefaultTips(step: PaymentWizardStep): string[] {
  switch (step) {
    case 'scan':
      return ['Ensure the QR code is well-lit.', 'Hold steady until the QR is detected.'];
    case 'connecting':
      return ['Keep Bluetooth enabled on both phones.', 'Stay within two meters of the merchant.'];
    case 'confirm':
      return ['Double-check the amount before continuing.', 'Bluetooth transfer starts immediately after confirmation.'];
    case 'broadcast':
      return ['Do not close the app while the bundle is sending.', 'If the merchant moves away, try again.'];
    case 'complete':
      return ['The bundle is stored on the merchant device.', 'You can settle from the Bundles section when online.'];
    case 'failed':
      return ['Tap Retry to attempt delivery again.', 'As a backup, share the fallback QR with the merchant.'];
    default:
      return [];
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  subtitle: {
    color: palette.textSecondary,
  },
  detail: {
    color: palette.textPrimary,
  },
  tips: {
    backgroundColor: 'rgba(148,163,184,0.1)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  bullet: {
    color: palette.textSecondary,
  },
  tip: {
    color: palette.textSecondary,
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  button: {
    flex: 1,
  },
});

