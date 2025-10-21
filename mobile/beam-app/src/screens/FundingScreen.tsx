import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, Alert, Linking, RefreshControl } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { wallet } from '../wallet/WalletManager';
import { faucetService } from '../services/FaucetService';
import { solanaFaucetService } from '../services/SolanaFaucetService';
import { Config } from '../config';
import { Screen } from '../components/ui/Screen';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Metric } from '../components/ui/Metric';
import { HeadingM, Body, Small, Micro } from '../components/ui/Typography';
import { palette, radius, spacing } from '../design/tokens';

interface FundingScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
  };
  route: {
    params: {
      role: 'customer' | 'merchant';
    };
  };
}

export function FundingScreen({ navigation, route }: FundingScreenProps) {
  const [requestingSol, setRequestingSol] = useState(false);
  const [requestingUsdc, setRequestingUsdc] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [solBalance, setSolBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [usdcTokenAccount, setUsdcTokenAccount] = useState<string>('');
  const { role } = route.params;

  const connection = useMemo(
    () => new Connection(Config.solana.rpcUrl, 'confirmed'),
    []
  );

  const loadBalances = useCallback(async () => {
    try {
      const pubkey = wallet.getPublicKey();
      if (!pubkey) {
        throw new Error('Wallet not loaded');
      }

      setWalletAddress(pubkey.toBase58());

      // Get SOL balance
      const solLamports = await connection.getBalance(pubkey);
      setSolBalance(solLamports / LAMPORTS_PER_SOL);

      // Get USDC token account address
      const usdcMint = new PublicKey(Config.tokens.usdc.mint);
      const tokenAccount = await getAssociatedTokenAddress(usdcMint, pubkey);
      setUsdcTokenAccount(tokenAccount.toBase58());

      // Try to get USDC balance
      try {
        const account = await getAccount(connection, tokenAccount);
        const balance = Number(account.amount) / Math.pow(10, Config.tokens.usdc.decimals);
        setUsdcBalance(balance);
      } catch (err) {
        // Token account doesn't exist yet
        setUsdcBalance(0);
      }
    } catch (err) {
      if (__DEV__) {
        console.error('Failed to load balances:', err);
      }
    }
  }, [connection]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadBalances();
    setRefreshing(false);
  };

  const handleRequestSOL = async () => {
    const pubkey = wallet.getPublicKey();
    if (!pubkey) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    setRequestingSol(true);
    try {
      // Use the faucet service which has fallback RPC endpoints
      const result = await solanaFaucetService.requestSolAirdrop(pubkey, 0.5);

      const sourceInfo = result.source === 'fallback-rpc'
        ? '\n\n(Using alternate RPC endpoint)'
        : '';

      Alert.alert(
        'Airdrop Requested',
        `Requesting ${result.amount} SOL from devnet faucet...${sourceInfo}\n\nTransaction: ${result.signature}\n\nRefresh in a few seconds to see updated balance.`,
        [
          {
            text: 'OK',
            onPress: () => {
              // Wait a bit then refresh
              setTimeout(() => {
                void loadBalances();
              }, 3000);
            },
          },
        ]
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message = error.message;

      // Provide helpful guidance based on error type
      let errorTitle = 'Airdrop Failed';
      let errorMessage = `Failed to request SOL airdrop:\n${message}`;

      if (solanaFaucetService.isInternalError(error)) {
        errorTitle = 'Faucet Temporarily Unavailable';
        errorMessage = `The Solana devnet faucet is experiencing high traffic or internal errors.\n\nPlease try one of these alternatives:\n\n1. Use web faucet: faucet.solana.com\n2. Try QuickNode faucet\n3. Wait a few minutes and try again`;
      } else if (solanaFaucetService.isRateLimitError(error)) {
        errorTitle = 'Rate Limit Reached';
        errorMessage = `You've reached the airdrop rate limit (2 SOL/hour, 24 SOL/day).\n\nPlease:\n1. Wait 1 hour and try again\n2. Use web faucet: faucet.solana.com\n3. Try a different network connection`;
      }

      Alert.alert(
        errorTitle,
        errorMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Web Faucet',
            onPress: () => {
              const faucetUrl = `https://faucet.solana.com/?address=${walletAddress}`;
              Linking.openURL(faucetUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open faucet: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
              });
            },
          },
        ]
      );
    } finally {
      setRequestingSol(false);
    }
  };

  const handleRequestUSDC = async () => {
    const pubkey = wallet.getPublicKey();
    if (!pubkey) {
      Alert.alert('Error', 'Wallet not loaded');
      return;
    }

    const faucetUrl = `https://spl-token-faucet.com/?token-name=USDC&mint=${Config.tokens.usdc.mint}`;
    const circleFaucetUrl = 'https://faucet.circle.com/';

    setRequestingUsdc(true);
    try {
      await faucetService.requestUsdc(pubkey.toBase58());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      Alert.alert(
        'Open Web Faucet',
        message,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open SPL Faucet',
            onPress: () => {
              Linking.openURL(faucetUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open faucet: ${openErr.message}`);
              });
            },
          },
          {
            text: 'Open Circle Faucet',
            onPress: () => {
              Linking.openURL(circleFaucetUrl).catch(openErr => {
                Alert.alert('Error', `Failed to open Circle faucet: ${openErr.message}`);
              });
            },
          },
        ]
      );
    } finally {
      setRequestingUsdc(false);
    }
  };

  const handleCopyAddress = async () => {
    Clipboard.setString(walletAddress);
    Alert.alert('Copied', 'Wallet address copied to clipboard');
  };

  const handleContinue = () => {
    if (solBalance === 0) {
      Alert.alert(
        'No SOL Balance',
        'You need SOL for transaction fees. Please request SOL from the faucet first.'
      );
      return;
    }

    if (role === 'customer' && usdcBalance === 0) {
      Alert.alert(
        'No USDC Balance',
        'You need USDC to create an escrow. Please request USDC from the faucet first.',
        [
          { text: 'Get USDC', onPress: handleRequestUSDC },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (role === 'merchant') {
      navigation.navigate('MerchantDashboard');
      return;
    }

    navigation.navigate('EscrowSetup', { role });
  };

  const hasSufficientFunds = solBalance > 0 && (role === 'merchant' || usdcBalance > 0);

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
          subtitle={
            role === 'customer'
              ? 'Request devnet SOL for fees and USDC for escrow funding'
              : 'Request devnet SOL for transaction fees'
          }
        />
      }
    >
      <Section
        title="Current balances"
        description="Pull down to refresh balances from devnet"
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
              caption={role === 'customer' ? 'For escrow funding' : 'Received payments'}
              accent="blue"
            />
          </View>
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

      {role === 'customer' && (
        <Section
          title="Get USDC"
          description="Request USDC tokens directly from the network faucet"
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
      )}

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
            label={role === 'customer' ? 'Continue to escrow setup' : 'Continue to dashboard'}
            onPress={handleContinue}
          />
        </Section>
      )}

      {!hasSufficientFunds && (
        <Section>
          <Card variant="highlight">
            <Body>
              ⚠️ {role === 'customer'
                ? 'You need both SOL and USDC to continue'
                : 'You need SOL to continue'}
            </Body>
            <Small style={styles.helper}>
              {role === 'customer'
                ? 'Request SOL above, then get USDC from the SPL Token Faucet'
                : 'Request SOL from the airdrop above'}
            </Small>
          </Card>
        </Section>
      )}
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
});
