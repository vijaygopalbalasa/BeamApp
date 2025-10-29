import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { bleDirect } from '../services/BLEDirectService';
import type { BLEDiagnostics } from '../services/BLEDirectService';
import { Card } from './ui/Card';
import { HeadingM, Body, Small } from './ui/Typography';
import { StatusBadge } from './ui/StatusBadge';
import { palette, spacing } from '../design/tokens';

interface MeshNetworkStatusProps {
  onPeerCountChange?: (count: number) => void;
}

export const MeshNetworkStatus: React.FC<MeshNetworkStatusProps> = ({ onPeerCountChange }) => {
  const [diagnostics, setDiagnostics] = useState<BLEDiagnostics>(bleDirect.getDiagnostics());
  const [pulseAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Subscribe to diagnostics updates
    const unsubscribe = bleDirect.addDiagnosticsListener((diag) => {
      setDiagnostics(diag);
      if (onPeerCountChange) {
        onPeerCountChange(0); // Will be updated when we add peer tracking
      }
    });

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

    return () => {
      unsubscribe();
    };
  }, [onPeerCountChange, pulseAnim]);

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.05],
  });

  const isActive = diagnostics.started;
  const hasRecentActivity = diagnostics.lastBroadcastAt
    ? Date.now() - diagnostics.lastBroadcastAt < 10000
    : false;

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
          label={isActive ? 'Active' : 'Inactive'}
          icon={isActive ? '📡' : '⏸️'}
        />
      </View>

      {isActive && (
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Small style={styles.metricLabel}>Queue</Small>
            <Body style={styles.metricValue}>{diagnostics.queueLength}</Body>
          </View>

          <View style={styles.divider} />

          <View style={styles.metric}>
            <Small style={styles.metricLabel}>Activity</Small>
            <Body style={styles.metricValue}>
              {hasRecentActivity ? '🟢 Recent' : '⚪ Idle'}
            </Body>
          </View>

          {diagnostics.lastError && (
            <>
              <View style={styles.divider} />
              <View style={styles.metric}>
                <Small style={styles.metricLabel}>Status</Small>
                <Body style={[styles.metricValue, styles.errorText]}>
                  ⚠️ {diagnostics.lastError.substring(0, 20)}...
                </Body>
              </View>
            </>
          )}
        </View>
      )}

      {!isActive && (
        <Small style={styles.inactiveText}>
          Enable mesh payments to broadcast bundles offline
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
