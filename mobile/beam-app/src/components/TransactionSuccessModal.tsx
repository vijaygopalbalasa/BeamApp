/**
 * Transaction Success Modal
 *
 * Shows transaction success with signature and Solana Explorer link
 */

import React from 'react';
import { Modal, View, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { HeadingM, Body, Small } from './ui/Typography';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { palette, spacing } from '../design/tokens';
import { Config } from '../config';

export interface TransactionSuccessModalProps {
  visible: boolean;
  type: 'online' | 'offline' | 'settled';
  role: 'customer' | 'merchant';
  amount: number; // in USDC
  signature?: string; // transaction signature
  bundleId?: string; // for offline payments
  onClose: () => void;
}

export function TransactionSuccessModal({
  visible,
  type,
  role,
  amount,
  signature,
  bundleId,
  onClose,
}: TransactionSuccessModalProps) {
  const getExplorerUrl = (sig: string) => {
    const network = Config.solana.network === 'devnet' ? 'devnet' : 'mainnet';
    return `https://explorer.solana.com/tx/${sig}?cluster=${network}`;
  };

  const openExplorer = () => {
    if (signature) {
      const url = getExplorerUrl(signature);
      Linking.openURL(url).catch(err => {
        console.error('[TransactionSuccessModal] Failed to open explorer:', err);
      });
    }
  };

  const getTitle = () => {
    if (type === 'online') {
      return role === 'customer' ? 'PAID!' : 'RECEIVED!';
    }
    if (type === 'offline') {
      return role === 'customer' ? 'Payment Sent!' : 'Payment Received!';
    }
    return 'Payment Complete!';
  };

  const getMessage = () => {
    if (type === 'online') {
      return role === 'customer'
        ? `You paid $${amount.toFixed(2)} to the merchant.\n\nConfirmed on blockchain.`
        : `You received $${amount.toFixed(2)} from customer.\n\nConfirmed on blockchain.`;
    }
    if (type === 'offline') {
      return role === 'customer'
        ? `Payment of $${amount.toFixed(2)} sent.\n\nWill complete when you're back online.`
        : `Payment of $${amount.toFixed(2)} received.\n\nWill complete when you're back online.`;
    }
    return `Payment of $${amount.toFixed(2)} is complete!`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Card variant="elevated" padding="lg" style={styles.modalCard}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Small style={styles.icon}>
              {type === 'offline' ? '📡' : '✅'}
            </Small>
          </View>

          {/* Title */}
          <HeadingM style={styles.title}>{getTitle()}</HeadingM>

          {/* Message */}
          <Body style={styles.message}>{getMessage()}</Body>

          {/* Amount Badge */}
          <View style={styles.amountBadge}>
            <Small style={styles.amountText}>
              {role === 'customer' && type !== 'offline' ? '-' : '+'}${amount.toFixed(2)} USDC
            </Small>
          </View>

          {/* Receipt Number (for online/settled) - SIMPLIFIED LANGUAGE */}
          {signature && (
            <View style={styles.signatureContainer}>
              <Small style={styles.signatureLabel}>Receipt Number:</Small>
              <TouchableOpacity onPress={openExplorer} style={styles.signatureBox}>
                <Small style={styles.signatureText}>
                  {signature.slice(0, 8)}...{signature.slice(-8)}
                </Small>
                <Small style={styles.linkIcon}>🔗</Small>
              </TouchableOpacity>
              <Small style={styles.exploreHint}>Tap to view receipt details</Small>
            </View>
          )}

          {/* Payment ID (for offline) - SIMPLIFIED LANGUAGE */}
          {bundleId && !signature && (
            <View style={styles.bundleContainer}>
              <Small style={styles.bundleLabel}>Payment ID:</Small>
              <View style={styles.bundleBox}>
                <Small style={styles.bundleText}>
                  {bundleId.slice(0, 16)}...
                </Small>
              </View>
            </View>
          )}

          {/* Close Button */}
          <Button
            variant="primary"
            size="md"
            onPress={onClose}
            style={styles.closeButton}
          >
            Done
          </Button>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  iconContainer: {
    width: 100, // Increased from 80 - BIGGER!
    height: 100,
    borderRadius: 50,
    backgroundColor: palette.successGreen + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 60, // Increased from 40 - HUGE checkmark for grandma!
  },
  title: {
    textAlign: 'center',
    marginBottom: spacing.sm,
    color: palette.neutral[900],
    fontSize: 32, // MUCH BIGGER title for excitement! (was ~18px)
    fontWeight: '900', // Extra bold
  },
  message: {
    textAlign: 'center',
    color: palette.neutral[600],
    marginBottom: spacing.lg,
    lineHeight: 24, // Increased from 22
    fontSize: 17, // Increased from default ~14px
  },
  amountBadge: {
    backgroundColor: palette.successGreen + '15',
    paddingHorizontal: spacing.lg, // Increased from md
    paddingVertical: spacing.md, // Increased from sm
    borderRadius: 12, // Bigger radius
    marginBottom: spacing.lg,
  },
  amountText: {
    fontSize: 28, // Increased from 18 - HUGE amount!
    fontWeight: '800', // Bolder
    color: palette.successGreen,
  },
  signatureContainer: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  signatureLabel: {
    color: palette.neutral[500],
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  signatureBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.neutral[100],
    padding: spacing.md,
    borderRadius: 8,
    gap: spacing.xs,
  },
  signatureText: {
    fontFamily: 'monospace',
    color: palette.accentBlue,
    fontSize: 13,
  },
  linkIcon: {
    fontSize: 14,
  },
  exploreHint: {
    color: palette.neutral[500],
    textAlign: 'center',
    marginTop: spacing.xs,
    fontSize: 11,
  },
  bundleContainer: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  bundleLabel: {
    color: palette.neutral[500],
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  bundleBox: {
    backgroundColor: palette.neutral[100],
    padding: spacing.md,
    borderRadius: 8,
  },
  bundleText: {
    fontFamily: 'monospace',
    color: palette.neutral[700],
    fontSize: 13,
    textAlign: 'center',
  },
  closeButton: {
    width: '100%',
  },
});
