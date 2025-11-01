import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { bleService } from '../services/BLEService';
import { Card } from './ui/Card';
import { HeadingM, Body, Small } from './ui/Typography';
import { StatusBadge } from './ui/StatusBadge';
import { palette, spacing } from '../design/tokens';

interface MeshNetworkStatusProps {
  onPeerCountChange?: (count: number) => void;
  isAdvertising?: boolean;
  isScanning?: boolean;
  connectedPeers?: number;
  statusLabelOverride?: string;
}

export const MeshNetworkStatus: React.FC<MeshNetworkStatusProps> = ({
  onPeerCountChange: _onPeerCountChange,
  isAdvertising = false,
  isScanning = false,
  connectedPeers = 0,
  statusLabelOverride,
}) => {
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Check bluetooth status
    bleService.isBluetoothEnabled().then(setBluetoothEnabled);

    // Start pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.05],
  });

  const isActive = bluetoothEnabled && (isAdvertising || isScanning);
  const secondaryLabel = statusLabelOverride
    ? statusLabelOverride
    : isActive
      ? connectedPeers > 0
        ? `${connectedPeers} peer${connectedPeers === 1 ? '' : 's'}`
        : isAdvertising
          ? 'Advertising'
          : 'Scanning'
      : bluetoothEnabled
        ? 'Idle'
        : 'Bluetooth off';

  return (
    <Card variant="glass" padding="md" style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Animated.View
            style={[
              styles.statusIndicator,
              {
                backgroundColor: isActive ? palette.success : palette.neutral,
                opacity: isActive ? pulseOpacity : 1,
                transform: [{ scale: isActive ? pulseScale : 1 }],
              },
            ]}
          />
          <HeadingM style={styles.title}>Mesh Network</HeadingM>
        </View>
        <StatusBadge
          status={isActive ? 'online' : 'offline'}
          label={isActive ? secondaryLabel : secondaryLabel}
          icon={isActive ? '📡' : '⏸️'}
        />
      </View>

      {isActive && (
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Small style={styles.metricLabel}>Mode</Small>
            <Body style={styles.metricValue}>
              {isAdvertising ? '📡 Advertising' : '🔍 Scanning'}
            </Body>
          </View>

          <View style={styles.divider} />

          <View style={styles.metric}>
            <Small style={styles.metricLabel}>Status</Small>
            <Body style={styles.metricValue}>
              {connectedPeers > 0 ? `🟢 ${connectedPeers} connected` : '🟡 Waiting'}
            </Body>
          </View>
        </View>
      )}

      {!isActive && (
        <Small style={styles.inactiveText}>
          {!bluetoothEnabled
            ? 'Enable Bluetooth to use BLE payments'
            : 'Start scanning or advertising to connect'}
        </Small>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  title: {
    color: palette.textPrimary,
  },
  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(226, 232, 240, 0.1)',
  },
  metric: {
    alignItems: 'center',
  },
  metricLabel: {
    color: palette.textSecondary,
    marginBottom: 4,
  },
  metricValue: {
    color: palette.textPrimary,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    backgroundColor: 'rgba(226, 232, 240, 0.1)',
  },
  errorText: {
    color: palette.danger,
    fontSize: 12,
  },
  inactiveText: {
    color: palette.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
