import React, { useEffect, useState } from 'react';
import { Modal, View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { meshDiagnosticsStore, type MeshDiagnosticEvent } from '../services/MeshDiagnosticsStore';
import { Card } from './ui/Card';
import { HeadingM, Body, Small } from './ui/Typography';
import { Button } from './ui/Button';
import { palette, radius, spacing } from '../design/tokens';

interface MeshDiagnosticsModalProps {
  visible: boolean;
  onClose: () => void;
}

const eventLabels: Record<string, string> = {
  advertising: 'Advertising',
  scan: 'Scan',
  'scan-result': 'Scan Result',
  'bundle-broadcast': 'Bundle Broadcast',
  connection: 'Connection',
  queue: 'Queue Snapshot',
  error: 'Error',
};

export const MeshDiagnosticsModal: React.FC<MeshDiagnosticsModalProps> = ({ visible, onClose }) => {
  const [events, setEvents] = useState<MeshDiagnosticEvent[]>([]);

  useEffect(() => {
    const unsubscribe = meshDiagnosticsStore.subscribe(setEvents);
    return unsubscribe;
  }, []);

  const renderEvent = ({ item }: { item: MeshDiagnosticEvent }) => {
    const timestamp = new Date(item.timestamp);
    const timeLabel = `${timestamp.toLocaleTimeString()} ${timestamp.toLocaleDateString()}`;
    const payloadString = JSON.stringify(item.payload, null, 2);

    return (
      <Card variant="glass" padding="md" style={styles.eventCard}>
        <View style={styles.eventHeader}>
          <HeadingM style={styles.eventTitle}>{eventLabels[item.type] ?? item.type}</HeadingM>
          <Small style={styles.eventTime}>{timeLabel}</Small>
        </View>
        <View style={styles.payloadContainer}>
          <Small style={styles.payloadLabel}>Payload</Small>
          <Small style={styles.payloadText}>{payloadString}</Small>
        </View>
      </Card>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <HeadingM>Mesh Diagnostics</HeadingM>
          <TouchableOpacity onPress={() => meshDiagnosticsStore.clear()}>
            <Small style={styles.clearLabel}>Clear</Small>
          </TouchableOpacity>
        </View>
        <Body style={styles.subtitle}>
          Bluetooth mesh and queue events. Use this when payments fail to deliver or settle.
        </Body>

        {renderQueueSummary(events)}

        <FlatList
          data={events}
          keyExtractor={event => event.id}
          renderItem={renderEvent}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Card variant="glass" padding="lg" style={styles.emptyState}>
              <Small style={styles.emptyText}>No mesh events yet. Try starting a payment flow.</Small>
            </Card>
          }
        />

        <Button label="Close" onPress={onClose} style={styles.closeButton} />
      </View>
    </Modal>
  );
};

function renderQueueSummary(events: MeshDiagnosticEvent[]) {
  const latestByRole = events
    .filter(event => event.type === 'queue')
    .reduce<Record<string, MeshDiagnosticEvent>>((acc, event) => {
      const role = typeof event.payload.role === 'string' ? (event.payload.role as string) : 'unknown';
      if (!acc[role] || (event.timestamp ?? 0) > (acc[role]?.timestamp ?? 0)) {
        acc[role] = event;
      }
      return acc;
    }, {});

  const roles = Object.keys(latestByRole);
  if (roles.length === 0) {
    return null;
  }

  return (
    <Card variant="glass" padding="md" style={styles.summaryCard}>
      <HeadingM style={styles.summaryTitle}>Current queue snapshots</HeadingM>
      {roles.map(role => {
        const event = latestByRole[role];
        const breakdown = (event.payload.breakdown as Record<string, number>) ?? {};
        const total = event.payload.total as number | undefined;
        return (
          <View key={role} style={styles.summaryRow}>
            <View style={styles.summaryHeaderRow}>
              <Small style={styles.summaryRole}>{role === 'customer' ? 'Customer' : 'Merchant'}</Small>
              <Small style={styles.summaryTimestamp}>{new Date(event.timestamp).toLocaleTimeString()}</Small>
            </View>
            <Body style={styles.summaryText}>
              Total: {total ?? 0}
            </Body>
            <View style={styles.breakdownRow}>
              {Object.entries(breakdown).map(([state, count]) => (
                <Small key={`${role}-${state}`} style={styles.breakdownTag}>
                  {state}: {count}
                </Small>
              ))}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: palette.surface,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: palette.textSecondary,
    marginBottom: spacing.md,
  },
  summaryCard: {
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    color: palette.textPrimary,
  },
  summaryRow: {
    gap: spacing.xs,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryRole: {
    color: palette.textPrimary,
    fontWeight: '600',
  },
  summaryTimestamp: {
    color: palette.textSecondary,
  },
  summaryText: {
    color: palette.textSecondary,
  },
  breakdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  breakdownTag: {
    backgroundColor: 'rgba(148,163,184,0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
    color: palette.textSecondary,
  },
  clearLabel: {
    color: palette.accentBlue,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  eventCard: {
    borderRadius: radius.md,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  eventTitle: {
    color: palette.textPrimary,
  },
  eventTime: {
    color: palette.textSecondary,
  },
  payloadContainer: {
    marginTop: spacing.xs,
  },
  payloadLabel: {
    color: palette.textSecondary,
    marginBottom: spacing.xs / 2,
  },
  payloadText: {
    color: palette.textPrimary,
    fontFamily: 'Courier',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: palette.textSecondary,
  },
  closeButton: {
    marginTop: spacing.md,
  },
});
