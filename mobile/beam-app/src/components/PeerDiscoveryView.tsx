import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, Animated, Easing, ActivityIndicator } from 'react-native';
import { Card } from './ui/Card';
import { Section } from './ui/Section';
import { HeadingM, Body, Small } from './ui/Typography';
import { palette, spacing, radius } from '../design/tokens';
import { bleDirect } from '../services/BLEDirectService';

interface Peer {
  address: string;
  name: string;
  rssi: number;
  connected: boolean;
  lastSeen?: number;
}

interface PeerDiscoveryViewProps {
  peers?: Peer[];
  onRefresh?: () => void;
}

export const PeerDiscoveryView: React.FC<PeerDiscoveryViewProps> = ({ peers: externalPeers, onRefresh }) => {
  const [internalPeers, setInternalPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);

  const peers = externalPeers || internalPeers;

  useEffect(() => {
    if (!externalPeers) {
      loadPeers();
      const interval = setInterval(loadPeers, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [externalPeers]);

  const loadPeers = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const peers = await bleDirect.requestPeers();
      setInternalPeers(peers.map(p => ({ ...p, lastSeen: Date.now() })));
    } catch (error) {
      console.error('[PeerDiscoveryView] Failed to load peers:', error);
    } finally {
      setLoading(false);
    }
  };
  const [pulseAnims] = useState(() =>
    peers.reduce((acc, peer) => {
      acc[peer.address] = new Animated.Value(0);
      return acc;
    }, {} as Record<string, Animated.Value>)
  );

  useEffect(() => {
    // Animate each connected peer
    peers.forEach((peer) => {
      if (peer.connected && pulseAnims[peer.address]) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnims[peer.address], {
              toValue: 1,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnims[peer.address], {
              toValue: 0,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        ).start();
      }
    });
  }, [peers, pulseAnims]);

  const getSignalStrength = (rssi: number): { icon: string; color: string; label: string } => {
    if (rssi > -50) return { icon: '📶', color: palette.success, label: 'Excellent' };
    if (rssi > -70) return { icon: '📶', color: palette.accentBlue, label: 'Good' };
    if (rssi > -85) return { icon: '📶', color: palette.warning, label: 'Fair' };
    return { icon: '📶', color: palette.danger, label: 'Weak' };
  };

  const renderPeer = ({ item: peer }: { item: Peer }) => {
    const signal = getSignalStrength(peer.rssi);
    const pulseAnim = pulseAnims[peer.address] || new Animated.Value(0);

    const pulseOpacity = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.5, 1],
    });

    return (
      <Animated.View style={[styles.peerCard, { opacity: peer.connected ? pulseOpacity : 0.6 }]}>
        <View style={styles.peerHeader}>
          <View style={styles.peerInfo}>
            <View
              style={[
                styles.peerStatus,
                { backgroundColor: peer.connected ? palette.success : palette.neutral },
              ]}
            />
            <HeadingM style={styles.peerName}>{peer.name || 'Unknown Device'}</HeadingM>
          </View>
          <View style={styles.signalBadge}>
            <Small style={[styles.signalIcon, { color: signal.color }]}>{signal.icon}</Small>
          </View>
        </View>

        <View style={styles.peerDetails}>
          <View style={styles.peerDetail}>
            <Small style={styles.detailLabel}>Address</Small>
            <Small style={styles.detailValue}>
              {peer.address.substring(0, 8)}...{peer.address.substring(peer.address.length - 8)}
            </Small>
          </View>

          <View style={styles.peerDetail}>
            <Small style={styles.detailLabel}>Signal</Small>
            <Small style={[styles.detailValue, { color: signal.color }]}>
              {signal.label} ({peer.rssi} dBm)
            </Small>
          </View>

          <View style={styles.peerDetail}>
            <Small style={styles.detailLabel}>Status</Small>
            <Small style={[styles.detailValue, { color: peer.connected ? palette.success : palette.textSecondary }]}>
              {peer.connected ? 'Connected' : 'Discovered'}
            </Small>
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <Section
      title="Nearby Peers"
      description={`${peers.length} device${peers.length !== 1 ? 's' : ''} in mesh range`}
    >
      {peers.length === 0 ? (
        <Card variant="glass" padding="lg" style={styles.emptyState}>
          <Body style={styles.emptyIcon}>📡</Body>
          <Body style={styles.emptyText}>Scanning for nearby devices...</Body>
          <Small style={styles.emptyHint}>
            Make sure Bluetooth is enabled and other devices have mesh payments active
          </Small>
        </Card>
      ) : (
        <FlatList
          data={peers}
          renderItem={renderPeer}
          keyExtractor={(item) => item.address}
          contentContainerStyle={styles.listContainer}
          scrollEnabled={false}
        />
      )}
    </Section>
  );
};

const styles = StyleSheet.create({
  listContainer: {
    gap: spacing.sm,
  },
  peerCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.1)',
  },
  peerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  peerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  peerStatus: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  peerName: {
    color: palette.textPrimary,
    flex: 1,
  },
  signalBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(100, 116, 139, 0.2)',
    borderRadius: radius.sm,
  },
  signalIcon: {
    fontSize: 16,
  },
  peerDetails: {
    gap: spacing.xs,
  },
  peerDetail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: palette.textSecondary,
  },
  detailValue: {
    color: palette.textPrimary,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    color: palette.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyHint: {
    color: palette.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
