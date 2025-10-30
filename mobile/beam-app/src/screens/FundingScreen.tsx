import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Alert, Linking, RefreshControl, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import { wallet } from '../wallet/WalletManager';
import { faucetService } from '../services/FaucetService';
import { solanaFaucetService } from '../services/SolanaFaucetService';
import { connectionService } from '../services/ConnectionService';
import { Config } from '../config';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { TransactionStatus, type TransactionStep } from '../components/ui/TransactionStatus';
import { HeadingM, Body, Small, Micro } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

const WALLET_FUNDED_KEY = '@beam:wallet_funded';

interface FundingScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
  };
}

export function FundingScreen({ navigation }: FundingScreenProps) {
  const [requestingSol, setRequestingSol] = useState(false);
  const [requestingUsdc, setRequestingUsdc] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [solBalance, setSolBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [usdcTokenAccount, setUsdcTokenAccount] = useState<string>('');
  const [lastBalanceUpdate, setLastBalanceUpdate] = useState<Date | null>(null);

  // Transaction status tracking for better UX
  const [showTransactionStatus, setShowTransactionStatus] = useState(false);
  const [transactionStep, setTransactionStep] = useState<TransactionStep>('submitting');
  const [transactionSignature, setTransactionSignature] = useState<string>('');
  const [transactionError, setTransactionError] = useState<string>('');

  const loadBalances = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoadingBalances(true);
    }

    try {
      const pubkey = wallet.getPublicKey();
      if (!pubkey) {
        throw new Error('Wallet not loaded');
      }

      if (__DEV__) {
        console.log('[FundingScreen] Fetching balances for', pubkey.toBase58());
      }

      setWalletAddress(pubkey.toBase58());

      // Use reliable connection service with automatic fallbacks
      const balances = await connectionService.getAllBalances(pubkey);

      setSolBalance(balances.solBalance);
      setUsdcBalance(balances.usdcBalance);
      setUsdcTokenAccount(balances.tokenAccount);

      // Update last refresh timestamp
      setLastBalanceUpdate(new Date());

      if (__DEV__) {
        console.log('[FundingScreen] Balances updated:', {
          SOL: balances.solBalance,
          USDC: balances.usdcBalance,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      if (__DEV__) {
        console.error('[FundingScreen] Failed to load balances:', err);
      }
      Alert.alert(
        'Balance Update Failed',
        'Could not fetch current balances. Please check your network connection and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      if (showLoading) {
        setLoadingBalances(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadBalances(false);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRequestSOL = async () => {
    const pubkey = wallet.getPublicKey();
    if (!pubkey) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    setRequestingSol(true);
    let airdropSuccessful = false;

    try {
      // Show transaction status modal - submitting
      setTransactionStep('submitting');
      setTransactionSignature('');
      setTransactionError('');
      setShowTransactionStatus(true);

      // Use the faucet service which has fallback RPC endpoints
      const result = await solanaFaucetService.requestSolAirdrop(pubkey, 0.5);
      airdropSuccessful = true;

      // Update transaction status - submitted
      setTransactionStep('submitted');
      setTransactionSignature(result.signature);

      // Wait a moment then show confirming state
      setTimeout(() => {
        setTransactionStep('confirming');
      }, 1000);

      // Auto-refresh balance multiple times to catch the update
      // Match devnet confirmation times (15-30 seconds typical)
      const checkConfirmation = async () => {
        // First refresh after 5 seconds
        setTimeout(async () => {
          await loadBalances(false);
        }, 5000);

        // Second refresh after 15 seconds (typical devnet confirmation)
        setTimeout(async () => {
          await loadBalances(false);
          setTransactionStep('confirmed');
          setTimeout(() => {
            setTransactionStep('finalizing');
          }, 1000);
        }, 15000);

        // Third refresh after 30 seconds (fallback for slow RPC)
        setTimeout(async () => {
          await loadBalances(false);
          setTransactionStep('finalized');
          // Auto-close modal after 3 seconds on success
          setTimeout(() => {
            setShowTransactionStatus(false);
          }, 3000);
        }, 30000);
      };

      void checkConfirmation();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message = error.message;

      // Provide helpful guidance based on error type
      let errorTitle = 'Airdrop Failed';
      let errorMessage = `Failed to request SOL airdrop:\n${message}`;

      if (solanaFaucetService.isInternalError(error)) {
        errorTitle = 'Faucet Temporarily Unavailable';
        errorMessage = 'The Solana devnet faucet is experiencing high traffic or internal errors.\n\nPlease try one of these alternatives:\n\n1. Use web faucet: faucet.solana.com\n2. Try QuickNode faucet\n3. Wait a few minutes and try again\n\nCurrent balance will be refreshed.';
      } else if (solanaFaucetService.isRateLimitError(error)) {
        errorTitle = 'Rate Limit Reached';
        errorMessage = 'You\'ve reached the airdrop rate limit (2 SOL/hour, 24 SOL/day).\n\nPlease:\n1. Wait 1 hour and try again\n2. Use web faucet: faucet.solana.com\n3. Try a different network connection\n\nYour current balance will be refreshed.';
      }

      // Show error in transaction status modal
      setTransactionStep('failed');
      setTransactionError(errorMessage);

      // Alert after a moment to give user time to see the error state
      setTimeout(() => {
        Alert.alert(
          errorTitle,
          errorMessage,
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => {
                setShowTransactionStatus(false);
                // Refresh on cancel to show current state
                void loadBalances(false);
              },
            },
            {
              text: 'Open Web Faucet',
              onPress: () => {
                setShowTransactionStatus(false);
                const faucetUrl = `https://faucet.solana.com/?address=${walletAddress}`;
                Linking.openURL(faucetUrl).catch(openErr => {
                  Alert.alert('Error', `Failed to open faucet: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
                });
                // Refresh balance after opening web faucet
                void loadBalances(false);
              },
            },
          ]
        );
      }, 2000);
    } finally {
      setRequestingSol(false);
      // Always refresh balance after airdrop attempt (success or failure)
      if (!airdropSuccessful) {
        void loadBalances(false);
      }
    }
  };

  const handleRequestUSDC = async () => {
    const pubkey = wallet.getPublicKey();
    if (!pubkey) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    setRequestingUsdc(true);

    try {
      const result = await faucetService.requestUsdc(pubkey.toBase58());
      const explorerUrl =
        result.explorerUrl ??
        `https://explorer.solana.com/tx/${result.signature}?cluster=${Config.solana.network}`;

      const successMessage =
        result.message ??
        [
          `Minted ${result.amount} USDC to your wallet.`,
          `Token account:\n${result.tokenAccount}`,
          `Transaction:\n${result.signature}`,
        ].join('\n\n');

      Alert.alert(
        'USDC Minted',
        successMessage,
        [
          {
            text: 'View on Explorer',
            onPress: () => {
              Linking.openURL(explorerUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open explorer: ${openErr.message}`);
              });
            },
          },
          {
            text: 'OK',
            onPress: () => void loadBalances(false),
          },
        ]
      );

      // Auto-refresh balance to show minted tokens
      setTimeout(() => void loadBalances(false), 3000);
      setTimeout(() => void loadBalances(false), 8000);
      setTimeout(() => void loadBalances(false), 15000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      Alert.alert(
        'USDC Request',
        `${message}\n\nPlease use one of the web faucets to get USDC tokens.\n\nYour balance will be refreshed.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              // Refresh on cancel to show current state
              void loadBalances(false);
            },
          },
          {
            text: 'Open SPL Faucet',
            onPress: () => {
              const faucetUrl = `https://spl-token-faucet.com/?token-name=USDC&mint=${Config.tokens.usdc.mint}`;
              Linking.openURL(faucetUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open faucet: ${openErr.message}`);
              });
              // Refresh balance after opening web faucet
              void loadBalances(false);
            },
          },
          {
            text: 'Open Circle Faucet',
            onPress: () => {
              const circleFaucetUrl = 'https://faucet.circle.com/';
              Linking.openURL(circleFaucetUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open Circle faucet: ${openErr.message}`);
              });
              // Refresh balance after opening web faucet
              void loadBalances(false);
            },
          },
        ]
      );
    } finally {
      setRequestingUsdc(false);
      // Always refresh balance after request attempt (success or failure)
      void loadBalances(false);
    }
  };

  const handleCopyAddress = async () => {
    Clipboard.setString(walletAddress);
    Alert.alert('Copied', 'Wallet address copied to clipboard');
  };

  const handleContinue = async () => {
    if (solBalance === 0) {
      Alert.alert(
        'No SOL Balance',
        'You need SOL for transaction fees. Please request SOL from the faucet first.'
      );
      return;
    }

    // Mark wallet as funded and navigate to Home screen
    try {
      await AsyncStorage.setItem(WALLET_FUNDED_KEY, 'true');
      navigation.navigate('Home');
    } catch (err) {
      if (__DEV__) {
        console.error('[FundingScreen] Failed to save funded state:', err);
      }
      // Still navigate even if storage fails
      navigation.navigate('Home');
    }
  };

  const hasSufficientFunds = solBalance > 0;

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={palette.accentBlue} />
      }
      header={
        <Hero
          chip={
            <StatusBadge
              status={hasSufficientFunds ? 'online' : 'pending'}
              label={hasSufficientFunds ? 'Wallet funded' : 'Needs funding'}
              icon={hasSufficientFunds ? '✅' : '⏳'}
            />
          }
          title="Fund your wallet"
          subtitle="Request devnet SOL for transaction fees and optionally USDC for payments"
        />
      }
    >
      <Section
        title="Current balances"
        description="Balances are updated automatically after airdrop requests"
      >
        <Card style={styles.metricsCard}>
          <View style={styles.metricsRow}>
            <Metric
              label="SOL"
              value={solBalance.toFixed(4)}
              caption="For transaction fees"
              accent="purple"
            />
            <Metric
              label="USDC"
              value={usdcBalance.toFixed(2)}
              caption="For payments"
              accent="blue"
            />
          </View>
          {lastBalanceUpdate && (
            <Small style={styles.lastUpdateText}>
              Last updated: {lastBalanceUpdate.toLocaleTimeString()}
            </Small>
          )}
          {loadingBalances && (
            <Small style={styles.loadingText}>
              Fetching latest balances...
            </Small>
          )}
          <Button
            label={refreshing ? 'Refreshing...' : 'Refresh balances'}
            variant="ghost"
            onPress={handleRefresh}
            loading={refreshing}
            disabled={refreshing || loadingBalances}
            style={styles.refreshButton}
          />
        </Card>
      </Section>

      <Section
        title="Your wallet address"
        description="Use this address to receive tokens from faucets"
      >
        <Card>
          <Micro>PUBLIC KEY</Micro>
          <Body selectable numberOfLines={1} style={styles.address}>
            {walletAddress}
          </Body>
          {usdcTokenAccount ? (
            <View style={styles.tokenAccountBlock}>
              <Micro>USDC TOKEN ACCOUNT</Micro>
              <Small selectable numberOfLines={1} style={styles.tokenAccountValue}>
                {usdcTokenAccount}
              </Small>
            </View>
          ) : null}
          <Button
            label="Copy address"
            variant="ghost"
            onPress={handleCopyAddress}
            style={styles.copyButton}
          />
        </Card>
      </Section>

      <Section
        title="Get devnet SOL"
        description="Request free SOL from Solana devnet faucet for transaction fees"
      >
        <Card style={styles.faucetCard}>
          <View style={styles.faucetContent}>
            <HeadingM>💧 Request 0.5 SOL</HeadingM>
            <Body style={styles.faucetDescription}>
              Network tokens for transaction fees. Required for all operations including escrow creation and settlements. Requesting smaller amounts helps avoid rate limits.
            </Body>
            <Button
              label={requestingSol ? 'Requesting...' : 'Request SOL airdrop'}
              onPress={handleRequestSOL}
              loading={requestingSol}
              disabled={requestingSol}
            />
          </View>
        </Card>
      </Section>

      <Section
        title="Get USDC (Optional)"
        description="Request USDC tokens for making payments"
      >
        <Card style={styles.faucetCard}>
          <View style={styles.faucetContent}>
            <HeadingM>💵 Request USDC</HeadingM>
            <Body style={styles.faucetDescription}>
              Beam contacts the SPL Token Faucet API on your behalf. If the automated request fails, you can still open the faucet manually.
            </Body>
            <Small style={styles.faucetMint}>
              USDC Mint: {Config.tokens.usdc.mint}
            </Small>
            <Button
              label={requestingUsdc ? 'Requesting...' : 'Request USDC airdrop'}
              variant="secondary"
              onPress={handleRequestUSDC}
              loading={requestingUsdc}
              disabled={requestingUsdc}
            />
          </View>
        </Card>
      </Section>

      <Section
        title="Alternative: Manual funding"
        description="Advanced users can transfer tokens directly"
      >
        <Card variant="glass">
          <Small style={styles.helper}>
            You can also use Solana CLI or other wallets to transfer devnet SOL and USDC to your wallet address shown above.
          </Small>
          <Small style={styles.helper}>
            Commands for reference:
            {'\n'}• solana airdrop 1 {walletAddress} --url devnet
            {'\n'}• spl-token transfer {Config.tokens.usdc.mint} 100 {walletAddress} --url devnet
          </Small>
        </Card>
      </Section>

      {hasSufficientFunds && (
        <Section>
          <Button
            label="Continue to Home"
            onPress={handleContinue}
          />
        </Section>
      )}

      {!hasSufficientFunds && (
        <Section>
          <Card variant="highlight">
            <Body>
              ⚠️ You need SOL to continue
            </Body>
            <Small style={styles.helper}>
              Request SOL from the airdrop above to enable transactions
            </Small>
          </Card>
        </Section>
      )}

      {/* Transaction Status Modal - NEW UX IMPROVEMENT */}
      <Modal
        visible={showTransactionStatus}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (transactionStep === 'finalized' || transactionStep === 'failed') {
            setShowTransactionStatus(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TransactionStatus
              step={transactionStep}
              signature={transactionSignature}
              network={Config.solana.network as 'mainnet' | 'devnet' | 'testnet'}
              estimatedTimeSeconds={30}
              error={transactionError}
              title={transactionStep === 'confirming' ? 'Confirming Transaction' : undefined}
              description={
                transactionStep === 'confirming'
                  ? 'Your balance will update automatically once confirmed. This typically takes 15-30 seconds on devnet.'
                  : undefined
              }
            />
            {(transactionStep === 'finalized' || transactionStep === 'failed') && (
              <Button
                label="Close"
                variant="ghost"
                onPress={() => setShowTransactionStatus(false)}
                style={styles.closeButton}
              />
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  metricsCard: {
    gap: spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  lastUpdateText: {
    color: 'rgba(148,163,184,0.7)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  loadingText: {
    color: palette.accentBlue,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  refreshButton: {
    marginTop: spacing.xs,
  },
  address: {
    fontFamily: 'Menlo',
    fontSize: 13,
    backgroundColor: 'rgba(148,163,184,0.08)',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    color: palette.textPrimary,
  },
  copyButton: {
    marginTop: spacing.sm,
  },
  tokenAccountBlock: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  tokenAccountValue: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: 'rgba(148,163,184,0.9)',
  },
  faucetCard: {
    gap: spacing.md,
  },
  faucetContent: {
    gap: spacing.md,
  },
  faucetDescription: {
    color: 'rgba(148,163,184,0.9)',
  },
  faucetMint: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: 'rgba(148,163,184,0.7)',
  },
  helper: {
    color: 'rgba(148,163,184,0.82)',
    lineHeight: 18,
  },
  // NEW: Modal styles for TransactionStatus
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxWidth: 480,
    gap: spacing.md,
  },
  closeButton: {
    width: '100%',
  },
});
