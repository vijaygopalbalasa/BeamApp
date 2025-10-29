import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Alert, ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, spacing, radius } from '../design/tokens';
import { wallet } from '../wallet/WalletManager';

interface WalletBackupScreenProps {
  navigation: { navigate: (screen: string) => void; goBack: () => void };
}

export function WalletBackupScreen({ navigation }: WalletBackupScreenProps) {
  const [address, setAddress] = useState<string>('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [backup, setBackup] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const pk = wallet.getPublicKey() || (await wallet.loadWallet());
      if (pk) setAddress(pk.toBase58());
    })();
  }, []);

  const generateBackup = useCallback(async () => {
    try {
      console.log('[WalletBackup] generateBackup called');

      // Validation: Check if passphrase is empty
      if (!pass1 || pass1.trim().length === 0) {
        console.log('[WalletBackup] Validation failed: empty passphrase');
        Alert.alert('Passphrase Required', 'Please enter a passphrase to protect your wallet backup.\n\nYour passphrase should be at least 8 characters long and memorable.');
        return;
      }

      // Validation: Check minimum length
      if (pass1.length < 8) {
        console.log('[WalletBackup] Validation failed: passphrase too short');
        Alert.alert('Passphrase Too Short', 'Please use at least 8 characters for security.\n\nA longer passphrase is more secure.');
        return;
      }

      // Validation: Check if confirmation is empty
      if (!pass2 || pass2.trim().length === 0) {
        console.log('[WalletBackup] Validation failed: empty confirmation');
        Alert.alert('Confirm Passphrase', 'Please re-enter your passphrase in the second field to confirm it.');
        return;
      }

      // Validation: Check if passphrases match
      if (pass1 !== pass2) {
        console.log('[WalletBackup] Validation failed: passphrases do not match');
        Alert.alert('Passphrases Don\'t Match', 'The passphrases you entered do not match.\n\nPlease make sure both fields contain the exact same passphrase.');
        return;
      }

      console.log('[WalletBackup] All validations passed, generating backup...');
      setBusy(true);

      const blob = await wallet.exportWallet(pass1);
      console.log('[WalletBackup] Export completed, blob length:', blob ? blob.length : 0);

      if (!blob || blob.trim().length === 0) {
        throw new Error('Failed to generate backup: empty backup data');
      }

      // Convert JSON to Base64 for user-friendly display
      const base64Backup = Buffer.from(blob, 'utf8').toString('base64');
      setBackup(base64Backup);
      console.log('[WalletBackup] Backup set successfully');
      Alert.alert('Backup Created Successfully', 'Your wallet has been encrypted and backed up.\n\nPlease copy the backup text below and store it in a safe place (like a password manager or encrypted file).\n\nYou will need both this backup AND your passphrase to restore your wallet.');
    } catch (error) {
      console.error('[WalletBackup] CRITICAL ERROR in generateBackup:', error);
      console.error('[WalletBackup] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      // Show user-friendly error
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Backup Failed', `Unable to create wallet backup.\n\nError: ${errorMessage}\n\nPlease try again or contact support if this persists.`);
    } finally {
      console.log('[WalletBackup] Cleaning up, setting busy to false');
      setBusy(false);
    }
  }, [pass1, pass2]);

  const copyToClipboard = useCallback(() => {
    if (backup) {
      Clipboard.setString(backup);
      Alert.alert('Copied!', 'Backup text copied to clipboard.\n\nNow paste it into a secure location (password manager, encrypted file, etc.)');
    }
  }, [backup]);

  const continueNext = async () => {
    if (!backup) {
      Alert.alert('Backup required', 'Generate and copy your backup first.');
      return;
    }
    try {
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem('@beam:wallet_backed_up', 'true');
    } catch {}
    navigation.navigate('Funding');
  };

  return (
    <Screen
      header={
        <Hero
          title="Back up your wallet"
          subtitle="Create a password-protected backup before continuing"
        />
      }
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <Small style={styles.label}>Wallet address</Small>
          <Body style={styles.address} selectable>{address || '—'}</Body>
        </Card>

        <Card style={styles.card}>
          <HeadingM>Create Backup Passphrase</HeadingM>
          <Body style={styles.instructions}>
            Your wallet backup will be encrypted with a passphrase. Choose a strong, memorable passphrase that you'll never forget.
          </Body>
          <Small style={styles.hint}>✓ At least 8 characters{'\n'}✓ Mix letters, numbers, and symbols{'\n'}✓ Don't use common words</Small>
          <Input
            label="Enter Passphrase"
            placeholder="e.g., MySecure$Wallet2024"
            secureTextEntry
            value={pass1}
            onChangeText={setPass1}
            helperText="Type a strong passphrase"
          />
          <Input
            label="Confirm Passphrase"
            placeholder="Type the same passphrase again"
            secureTextEntry
            value={pass2}
            onChangeText={setPass2}
            error={pass2.length > 0 && pass1 !== pass2 ? 'Passphrases do not match' : undefined}
            helperText={pass2.length > 0 && pass1 === pass2 ? '✓ Passphrases match' : 'Re-enter to confirm'}
          />
          <Button label={busy ? 'Creating Backup…' : 'Generate Backup'} onPress={generateBackup} disabled={busy} />
        </Card>

        {backup ? (
          <Card style={styles.successCard}>
            <Body style={styles.successIcon}>✅</Body>
            <HeadingM>Backup Created Successfully!</HeadingM>
            <Body style={styles.instructions}>
              Your encrypted backup is shown below. Copy this text and store it somewhere safe:
              {'\n'}• Password manager (recommended)
              {'\n'}• Encrypted file on your computer
              {'\n'}• Secure cloud storage
              {'\n\n'}⚠️ You need BOTH the backup text AND your passphrase to restore your wallet.
            </Body>
            <Input
              multiline
              value={backup}
              editable={false}
              containerStyle={styles.inputContainer}
              style={styles.multiline}
            />
            <Button label="📋 Copy to Clipboard" onPress={copyToClipboard} />
            <Button label="I've Saved My Backup, Continue" variant="secondary" onPress={continueNext} />
          </Card>
        ) : null}
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
  successCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderColor: palette.success,
    borderWidth: 1,
  },
  label: {
    color: palette.textSecondary,
  },
  hint: {
    color: 'rgba(148,163,184,0.82)',
    lineHeight: 20,
  },
  instructions: {
    color: 'rgba(148,163,184,0.9)',
    lineHeight: 22,
  },
  successIcon: {
    fontSize: 32,
    textAlign: 'center',
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 12,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: spacing.md,
    borderRadius: radius.sm,
    color: palette.textPrimary,
  },
  inputContainer: { width: '100%' },
  multiline: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
