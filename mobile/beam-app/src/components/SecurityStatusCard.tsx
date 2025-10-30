/**
 * Security Status Card
 *
 * Displays device security level and verifier backend health status
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { playIntegrityService } from '../services/PlayIntegrityService';
import { attestationIntegration } from '../services/AttestationIntegrationService';
import { Card } from './ui/Card';
import { HeadingM, Body, Small } from './ui/Typography';
import { StatusBadge } from './ui/StatusBadge';
import { palette, spacing } from '../design/tokens';

interface SecurityStatusCardProps {
  onStatusChange?: (isSecure: boolean) => void;
}

export const SecurityStatusCard: React.FC<SecurityStatusCardProps> = ({ onStatusChange }) => {
  const [securityLevel, setSecurityLevel] = useState<'STRONGBOX' | 'TEE' | 'SOFTWARE' | null>(null);
  const [isSecure, setIsSecure] = useState<boolean>(false);
  const [verifierOnline, setVerifierOnline] = useState<boolean | null>(null);
  const [reputation, setReputation] = useState<{
    score: number;
    transactions: number;
    blacklisted: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSecurityStatus = useCallback(async () => {
    setLoading(true);

    try {
      // Get device security level
      const secInfo = await playIntegrityService.checkSecurityLevel();
      setSecurityLevel(secInfo.securityLevel);
      setIsSecure(secInfo.isSecure);

      // Check verifier health
      const healthOk = await attestationIntegration.checkVerifierHealth();
      setVerifierOnline(healthOk);

      // Get device reputation
      if (healthOk) {
        try {
          const rep = await attestationIntegration.checkDeviceReputation();
          setReputation({
            score: rep.reputationScore,
            transactions: rep.totalTransactions,
            blacklisted: rep.blacklisted,
          });
        } catch (error) {
          // Reputation check failed, but that's okay
          console.log('[SecurityStatusCard] Reputation check failed:', error);
        }
      }

      if (onStatusChange) {
        onStatusChange(secInfo.isSecure && healthOk);
      }
    } catch (error) {
      console.error('[SecurityStatusCard] Failed to load security status:', error);
      setIsSecure(false);
      if (onStatusChange) {
        onStatusChange(false);
      }
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    loadSecurityStatus();
  }, [loadSecurityStatus]);

  if (loading) {
    return (
      <Card variant="glass">
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={palette.accentBlue} />
          <Small style={styles.loadingText}>Checking security...</Small>
        </View>
      </Card>
    );
  }

  const getSecurityIcon = (level: string | null) => {
    if (!level) return '🔒';
    if (level === 'STRONGBOX') return '🛡️';
    if (level === 'TEE') return '🔐';
    return '🔓';
  };

  const getSecurityLabel = (level: string | null) => {
    if (!level) return 'Unknown';
    if (level === 'STRONGBOX') return 'StrongBox';
    if (level === 'TEE') return 'TEE';
    return 'Software';
  };

  const getReputationColor = (score: number) => {
    if (score >= 10) return palette.success;
    if (score >= 0) return palette.accentBlue;
    if (score >= -10) return palette.warning;
    return palette.danger;
  };

  return (
    <Card variant="glass">
      <View style={styles.header}>
        <HeadingM>Security Status</HeadingM>
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <Small style={styles.label}>Device Security</Small>
          <View style={styles.valueContainer}>
            <Small style={styles.icon}>{getSecurityIcon(securityLevel)}</Small>
            <Body style={[styles.value, { color: isSecure ? palette.success : palette.warning }]}>
              {getSecurityLabel(securityLevel)}
            </Body>
          </View>
        </View>

        <View style={styles.row}>
          <Small style={styles.label}>Verifier Backend</Small>
          <View style={styles.valueContainer}>
            <Small style={styles.icon}>{verifierOnline ? '✅' : '❌'}</Small>
            <Body style={[styles.value, { color: verifierOnline ? palette.success : palette.danger }]}>
              {verifierOnline ? 'Online' : 'Offline'}
            </Body>
            <StatusBadge label={verifierOnline ? 'Online' : 'Offline'} status={verifierOnline ? 'online' : 'offline'} />
          </View>
        </View>

        {reputation && !reputation.blacklisted && (
          <View style={styles.row}>
            <Small style={styles.label}>Reputation</Small>
            <View style={styles.valueContainer}>
              <Small style={styles.icon}>⭐</Small>
              <Body style={[styles.value, { color: getReputationColor(reputation.score) }]}>
                {reputation.score} ({reputation.transactions} tx)
              </Body>
            </View>
          </View>
        )}

        {reputation?.blacklisted && (
          <View style={[styles.row, styles.errorRow]}>
            <Small style={styles.label}>⚠️ Warning</Small>
            <Body style={[styles.value, { color: palette.danger }]}>Device Blacklisted</Body>
          </View>
        )}
      </View>

      {!isSecure && (
        <View style={styles.warning}>
          <Small style={styles.warningText}>
            ⚠️ Hardware security not available. Transactions may be less secure.
          </Small>
        </View>
      )}

      {!verifierOnline && (
        <View style={styles.warning}>
          <Small style={styles.warningText}>
            ⚠️ Verifier backend offline. Attestation unavailable.
          </Small>
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  loadingText: {
    color: palette.textSecondary,
  },
  header: {
    marginBottom: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  errorRow: {
    backgroundColor: palette.danger + '20',
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  label: {
    color: palette.textSecondary,
    flex: 1,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: 16,
  },
  value: {
    fontWeight: '600',
  },
  warning: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: palette.warning + '20',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: palette.warning,
  },
  warningText: {
    color: palette.warning,
    lineHeight: 18,
  },
});
