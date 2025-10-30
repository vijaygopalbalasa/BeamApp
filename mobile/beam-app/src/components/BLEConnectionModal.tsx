/**
 * BLE Connection Confirmation Modal
 *
 * Shows connection status and confirmation to users
 * when BLE connection is established between customer and merchant.
 */

import React from 'react';
import { Modal, View, StyleSheet, ActivityIndicator } from 'react-native';
import { HeadingM, Body, Small } from './ui/Typography';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { palette, spacing, radius } from '../design/tokens';

export interface BLEConnectionModalProps {
  visible: boolean;
  status: 'searching' | 'connecting' | 'connected' | 'failed';
  peerName?: string;
  role: 'customer' | 'merchant';
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function BLEConnectionModal({
  visible,
  status,
  peerName,
  role,
  onConfirm,
  onCancel,
}: BLEConnectionModalProps) {
  const getStatusInfo = () => {
    switch (status) {
      case 'searching':
        return {
          icon: '🔍',
          // SIMPLIFIED: Remove technical jargon "Merchant/Customer"
          title: role === 'customer' ? 'Looking for merchant nearby...' : 'Waiting for customer...',
          message: role === 'customer'
            ? 'Make sure the merchant device is nearby (within 10 meters)'
            : 'Customer will connect when ready to pay',
          showSpinner: true,
          showButtons: true,
        };
      case 'connecting':
        return {
          icon: '🔗',
          title: 'Connecting...',
          // SIMPLIFIED: Remove "Establishing secure connection"
          message: `Connecting to ${peerName || 'merchant'}...`,
          showSpinner: true,
          showButtons: false,
        };
      case 'connected':
        return {
          icon: '✅',
          // SIMPLIFIED: Remove "Connection Established"
          title: 'Connected!',
          message: role === 'customer'
            ? `Connected to ${peerName || 'merchant'}. Ready to pay!`
            : `${peerName || 'Customer'} is connected. Ready to receive payment!`,
          showSpinner: false,
          showButtons: true,
        };
      case 'failed':
        return {
          icon: '❌',
          // SIMPLIFIED: Clearer error message
          title: role === 'customer' ? 'Merchant Not Found' : 'Connection Failed',
          message: role === 'customer'
            ? 'Could not find the merchant. Make sure:\n• The merchant device is nearby (within 10 meters)\n• Both devices have Bluetooth turned on'
            : 'Customer could not connect. Make sure both devices have Bluetooth turned on.',
          showSpinner: false,
          showButtons: true,
        };
    }
  };

  const info = getStatusInfo();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <Card variant="elevated" padding="lg" style={styles.modalCard}>
          <View style={styles.iconContainer}>
            <Small style={styles.icon}>{info.icon}</Small>
          </View>

          <HeadingM style={styles.title}>{info.title}</HeadingM>
          <Body style={styles.message}>{info.message}</Body>

          {info.showSpinner && (
            <View style={styles.spinnerContainer}>
              <ActivityIndicator size="large" color={palette.accentBlue} />
            </View>
          )}

          {info.showButtons && (
            <View style={styles.buttonContainer}>
              {status === 'connected' && onConfirm && (
                <Button
                  variant="primary"
                  size="md"
                  onPress={onConfirm}
                  style={styles.button}
                >
                  Continue
                </Button>
              )}

              {status === 'failed' && onConfirm && (
                <Button
                  variant="primary"
                  size="md"
                  onPress={onConfirm}
                  style={styles.button}
                >
                  Try Again
                </Button>
              )}

              {(status === 'searching' || status === 'failed') && onCancel && (
                <Button
                  variant="secondary"
                  size="md"
                  onPress={onCancel}
                  style={styles.button}
                >
                  Cancel
                </Button>
              )}
            </View>
          )}
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
    maxWidth: 400,
    alignItems: 'center',
  },
  iconContainer: {
    width: 100, // Increased from 80
    height: 100, // Increased from 80
    borderRadius: 50, // Increased from 40
    backgroundColor: palette.neutral[100],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 50, // Increased from 40 (BIGGER for grandma!)
  },
  title: {
    textAlign: 'center',
    marginBottom: spacing.sm,
    color: palette.neutral[900],
    fontSize: 24, // BIGGER title (default is ~18px)
    fontWeight: '700', // Bolder
  },
  message: {
    textAlign: 'center',
    color: palette.neutral[600],
    marginBottom: spacing.lg,
    fontSize: 16, // Increased from default ~14px
    lineHeight: 24, // Better readability
  },
  spinnerContainer: {
    marginVertical: spacing.md,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  button: {
    flex: 1,
  },
});
