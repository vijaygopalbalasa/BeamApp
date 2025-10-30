import React, { useEffect, useState, useCallback } from 'react';
import { View, TextInput, StyleSheet, Alert, ScrollView, Share } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { HeadingM, Small, Body } from '../components/ui/Typography';
import { palette, spacing, radius } from '../design/tokens';
import { wallet } from '../wallet/WalletManager';
import Clipboard from '@react-native-clipboard/clipboard';
import { loadUseServerSettlementOverride, setUseServerSettlementOverride, getUseServerSettlement } from '../utils/flags';
import { networkDiagnostics } from '../services/NetworkDiagnosticsService';
import { connectionService } from '../services/ConnectionService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../config';
import { useUiPrefs } from '../ui/UiPreferencesContext';
import { InfoButton } from '../components/ui/InfoButton';

interface SettingsProps { navigation: { navigate: (screen: string) => void } }

export function SettingsScreen({ navigation }: SettingsProps) {
  const { fontScale, setFontScale } = useUiPrefs();
  const [address, setAddress] = useState<string>('');
  const [useServerSettlement, setUseServerSettlement] = useState<boolean>(getUseServerSettlement());
  const [exportPass, setExportPass] = useState<string>('');
  const [backupBlob, setBackupBlob] = useState<string>('');
  const [importPass, setImportPass] = useState<string>('');
  const [exported, setExported] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [latencies, setLatencies] = useState<{ url: string; ms: number }[]>([]);
  const [currentRpc, setCurrentRpc] = useState<string>('');

  useEffect(() => {
    (async () => {
      const pk = wallet.getPublicKey() || (await wallet.loadWallet());
      if (pk) setAddress(pk.toBase58());
      const flag = await loadUseServerSettlementOverride();
      setUseServerSettlement(flag);
      setCurrentRpc(connectionService.getCurrentRpcUrl());
    })();
  }, []);

  const handleToggleSettlement = () => {
    const next = !useServerSettlement;
    setUseServerSettlement(next);
    setUseServerSettlementOverride(next);
    Alert.alert('Preference Saved', next ? 'Server settlement enabled' : 'On-device settlement enabled');
  };

  const handleExport = async () => {
    if (!exportPass || exportPass.length < 8) {
      Alert.alert('Passphrase Required', 'Use at least 8 characters.');
      return;
    }
    try {
      setBusy(true);
      const blob = await wallet.exportWallet(exportPass);
      setExported(blob);
      Alert.alert('Wallet Exported', 'Copy the backup blob and store it securely.');
    } catch (e) {
      Alert.alert('Export Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!importPass || importPass.length < 8 || !backupBlob) {
      Alert.alert('Import Data Required', 'Provide backup blob and passphrase.');
      return;
    }
    try {
      setBusy(true);
      const pubkey = await wallet.importWallet(importPass, backupBlob);
      setAddress(pubkey.toBase58());
      Alert.alert('Wallet Imported', 'Your wallet has been restored.');
    } catch (e) {
      Alert.alert('Import Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runDiagnostics = async () => {
    setBusy(true);
    try {
      const endpoints = [connectionService.getCurrentRpcUrl(), ...new Set([...(Config.solana.fallbackRpcUrls || [])])];
      const results: { url: string; ms: number }[] = [];
      for (const url of endpoints) {
        const ms = await networkDiagnostics.measureLatency(url);
        results.push({ url, ms });
      }
      setLatencies(results);
    } finally {
      setBusy(false);
    }
  };

  const handleUseEndpoint = useCallback(async (url: string) => {
    connectionService.setRpcOverride(url);
    await AsyncStorage.setItem('@beam:rpc_override', url);
    setCurrentRpc(url);
    Alert.alert('RPC Updated', `Now using ${url}`);
  }, []);

  const resetEndpoint = async () => {
    connectionService.setRpcOverride(null);
    await AsyncStorage.removeItem('@beam:rpc_override');
    setCurrentRpc(connectionService.getCurrentRpcUrl());
    Alert.alert('RPC Reset', 'Using default endpoint');
  };

  return (
    <Screen scrollable={true}>
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <HeadingM>Settings</HeadingM>
          <Small style={styles.label}>Wallet address</Small>
          <Body style={styles.address}>{address || '—'}</Body>
          <Button label="Copy address" variant="secondary" onPress={() => { Clipboard.setString(address); Alert.alert('Copied', 'Wallet address copied to clipboard'); }} />
          <Button label="Share address" variant="secondary" onPress={() => Share.share({ message: address })} />
          <Button label="Show QR" variant="secondary" onPress={() => navigation.navigate('WalletQR')} />
          <View style={styles.row}>
            <Small style={styles.label}>Server settlement</Small>
            <Button label={useServerSettlement ? 'On' : 'Off'} variant="secondary" onPress={handleToggleSettlement} />
          </View>
        </Card>

        <Card style={styles.card}>
          <HeadingM>Backup wallet</HeadingM>
          <Small style={styles.label}>Passphrase</Small>
          <TextInput
            placeholder="Enter backup passphrase"
            placeholderTextColor="#64748b"
            secureTextEntry
            style={styles.input}
            value={exportPass}
            onChangeText={setExportPass}
          />
          <Button label={busy ? 'Working…' : 'Export'} onPress={handleExport} disabled={busy} />
          {!!exported && (
            <>
              <Small style={[styles.label, { marginTop: spacing.md }]}>Backup blob</Small>
              <TextInput style={[styles.input, styles.multiline]} multiline value={exported} editable={false} />
            </>
          )}
        </Card>

        <Card style={styles.card}>
          <HeadingM>Restore wallet</HeadingM>
          <Small style={styles.label}>Backup blob</Small>
          <TextInput
            placeholder="Paste your backup blob"
            placeholderTextColor="#64748b"
            style={[styles.input, styles.multiline]}
            multiline
            value={backupBlob}
            onChangeText={setBackupBlob}
          />
          <Small style={styles.label}>Passphrase</Small>
          <TextInput
            placeholder="Enter backup passphrase"
            placeholderTextColor="#64748b"
            secureTextEntry
            style={styles.input}
            value={importPass}
            onChangeText={setImportPass}
          />
          <Button label={busy ? 'Working…' : 'Import'} onPress={handleImport} variant="secondary" disabled={busy} />
        </Card>

        <Card style={styles.card}>
          <HeadingM>Accessibility</HeadingM>
          <Small style={styles.label}>Text size</Small>
          <View style={styles.row}>
            <Button label="Default" variant={fontScale === 1 ? 'primary' : 'secondary'} onPress={() => setFontScale(1)} />
            <Button label="Large" variant={fontScale > 1 ? 'primary' : 'secondary'} onPress={() => setFontScale(1.2)} />
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <HeadingM>Network diagnostics</HeadingM>
            <InfoButton title="What is this?" message="Test different RPC servers to choose the fastest for your connection." />
          </View>
          <Small style={styles.label}>Current RPC</Small>
          <Body style={styles.address}>{currentRpc}</Body>
          <Button label={busy ? 'Testing…' : 'Test endpoints'} onPress={runDiagnostics} disabled={busy} />
          {latencies.map(({ url, ms }) => (
            <View key={url} style={styles.row}>
              <Small style={{ flex: 1, color: 'rgba(148,163,184,0.9)' }}>{url}</Small>
              <Small style={{ width: 80, textAlign: 'right', color: ms === Infinity ? '#ef4444' : undefined }}>{ms === Infinity ? 'timeout' : `${ms} ms`}</Small>
              <Button label="Use" variant="secondary" onPress={() => handleUseEndpoint(url)} />
            </View>
          ))}
          {latencies.length > 0 ? (
            <Button
              label="Use fastest endpoint"
              variant="secondary"
              onPress={() => {
                const best = latencies.filter(l => isFinite(l.ms)).sort((a, b) => a.ms - b.ms)[0];
                if (best) handleUseEndpoint(best.url);
                else Alert.alert('No fast endpoint', 'All tested endpoints timed out');
              }}
            />
          ) : null}
          <Button label="Reset to default" variant="secondary" onPress={resetEndpoint} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  label: {
    color: palette.textSecondary,
  },
  address: {
    color: palette.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: palette.textPrimary,
    backgroundColor: 'rgba(2,6,23,0.6)',
  },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
