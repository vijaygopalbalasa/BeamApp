import React, { useState, useCallback } from 'react';
import { StyleSheet, Alert, ScrollView, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, spacing, radius } from '../design/tokens';
import { wallet } from '../wallet/WalletManager';

interface WalletImportScreenProps {
  navigation: { navigate: (screen: string) => void; goBack: () => void };
}

export function WalletImportScreen({ navigation }: WalletImportScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [backupData, setBackupData] = useState('');
  const [busy, setBusy] = useState(false);

  const handleImport = useCallback(async () => {
    try {
      console.log('[WalletImport] handleImport called');

      // Validation: Check if passphrase is empty
      if (!passphrase || passphrase.trim().length === 0) {
        console.log('[WalletImport] Validation failed: empty passphrase');
        Alert.alert(
          'Passphrase Required',
          'Please enter the passphrase you used when creating this backup.\n\nThis is the same passphrase you set during wallet backup.'
        );
        return;
      }

      // Validation: Check if backup data is empty
      if (!backupData || backupData.trim().length === 0) {
        console.log('[WalletImport] Validation failed: empty backup data');
        Alert.alert(
          'Backup Data Required',
          'Please paste your wallet backup text.\n\nThis is the encrypted backup you saved when exporting your wallet.'
        );
        return;
      }

      console.log('[WalletImport] All validations passed, attempting import...');
      setBusy(true);

      // Decode base64 backup to JSON (inverse of export process, React Native safe)
      let decryptedBackup: string;
      try {
        decryptedBackup = Buffer.from(backupData.trim(), 'base64').toString('utf8');
      } catch (err) {
        throw new Error('Invalid backup format. Please check that you copied the complete backup text.');
      }

      // Import wallet using WalletManager
      const publicKey = await wallet.importWallet(passphrase, decryptedBackup);
      console.log('[WalletImport] Import successful, public key:', publicKey.toBase58());

      // ✅ FIX: Mark wallet as backed up since user imported from a backup
      try {
        await AsyncStorage.setItem('@beam:wallet_backed_up', 'true');
        console.log('[WalletImport] ✅ Wallet backup flag set');
      } catch (error) {
        console.error('[WalletImport] Failed to set wallet backup flag:', error);
      }

      Alert.alert(
        'Wallet Restored Successfully!',
        `Your wallet has been imported.\n\nAddress:\n${publicKey.toBase58().slice(0, 8)}...${publicKey.toBase58().slice(-8)}\n\nNext, let's check if your wallet needs funding.`,
        [
          {
            text: 'Continue',
            onPress: () => {
              // ✅ FIX Bug #2: Navigate to Funding screen to check if wallet has funds
              // This ensures the app doesn't redirect to Funding on restart
              navigation.navigate('Funding');
            },
          },
        ]
      );
    } catch (error) {
      console.error('[WalletImport] CRITICAL ERROR in handleImport:', error);
      console.error('[WalletImport] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      // Show user-friendly error
      const errorMessage = error instanceof Error ? error.message : String(error);

      let friendlyMessage = `Unable to import wallet.\n\nError: ${errorMessage}`;

      // Provide helpful hints for common errors
      if (errorMessage.toLowerCase().includes('passphrase') || errorMessage.toLowerCase().includes('decrypt')) {
        friendlyMessage = 'Incorrect passphrase.\n\nPlease make sure you\'re using the same passphrase you set when creating the backup.';
      } else if (errorMessage.toLowerCase().includes('format') || errorMessage.toLowerCase().includes('parse')) {
        friendlyMessage = 'Invalid backup data.\n\nPlease make sure you copied the complete backup text without any modifications.';
      }

      Alert.alert('Import Failed', friendlyMessage);
    } finally {
      console.log('[WalletImport] Cleaning up, setting busy to false');
      setBusy(false);
    }
  }, [passphrase, backupData, navigation]);

  return (
    <Screen scrollable={true}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Hero
          title="Import Existing Wallet"
          subtitle="Restore your wallet from a backup"
        />

        <Card style={styles.card}>
          <HeadingM style={styles.sectionTitle}>Security Notice</HeadingM>
          <Small style={styles.infoText}>
            To restore your wallet, you'll need:
          </Small>
          <View style={styles.requirements}>
            <Small style={styles.requirementItem}>• Your encrypted backup text</Small>
            <Small style={styles.requirementItem}>• The passphrase you used during backup</Small>
          </View>
          <Small style={styles.warningText}>
            ⚠️ Never share your backup or passphrase with anyone. Beam will never ask for this information.
          </Small>
        </Card>

        <Card style={styles.card}>
          <HeadingM style={styles.sectionTitle}>Passphrase</HeadingM>
          <Small style={styles.labelText}>
            Enter the passphrase you used when creating this backup
          </Small>
          <TextInput
            style={styles.input}
            placeholder="Enter your passphrase"
            placeholderTextColor={palette.textSecondary}
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry={true}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
        </Card>

        <Card style={styles.card}>
          <HeadingM style={styles.sectionTitle}>Backup Data</HeadingM>
          <Small style={styles.labelText}>
            Paste your encrypted wallet backup below
          </Small>
          <TextInput
            style={[styles.input, styles.backupInput]}
            placeholder="Paste your backup text here"
            placeholderTextColor={palette.textSecondary}
            value={backupData}
            onChangeText={setBackupData}
            multiline={true}
            numberOfLines={6}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <Small style={styles.hintText}>
            This is the long text you copied when backing up your wallet
          </Small>
        </Card>

        <View style={styles.actions}>
          <Button
            label="Import Wallet"
            onPress={handleImport}
            disabled={busy || !passphrase || !backupData}
            style={styles.importButton}
          />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => navigation.goBack()}
            disabled={busy}
            style={styles.cancelButton}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: palette.textPrimary,
    marginBottom: spacing.sm,
  },
  infoText: {
    color: palette.textSecondary,
    marginBottom: spacing.sm,
  },
  requirements: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  requirementItem: {
    color: palette.textSecondary,
    marginVertical: spacing.xs,
  },
  warningText: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.1)',
    padding: spacing.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  labelText: {
    color: palette.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: 'rgba(51,65,85,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    borderRadius: radius.md,
    padding: spacing.md,
    color: palette.textPrimary,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  backupInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  hintText: {
    color: 'rgba(148,163,184,0.6)',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  importButton: {
    marginTop: spacing.sm,
  },
  cancelButton: {
    marginTop: spacing.xs,
  },
});
