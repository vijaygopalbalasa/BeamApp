import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Screen } from '../components/ui/Screen';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Hero } from '../components/ui/Hero';
import { HeadingM, Body, Small } from '../components/ui/Typography';
import { palette, spacing } from '../design/tokens';
import { wallet } from '../wallet/WalletManager';
import { PublicKey } from '@solana/web3.js';
import { connectionService } from '../services/ConnectionService';
import { useFocusEffect } from '@react-navigation/native';

interface HomeScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
  };
}

export function HomeScreen({ navigation }: HomeScreenProps) {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [escrowBalance, setEscrowBalance] = useState<number>(0);
  const [escrowExists, setEscrowExists] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  const ensureWallet = useCallback(async (): Promise<string | null> => {
    console.log('[HomeScreen] ensureWallet called');
    try {
      console.log('[HomeScreen] Checking for existing wallet...');
      const existing = wallet.getPublicKey();
      if (existing) {
        const address = existing.toBase58();
        console.log('[HomeScreen] ✅ Found existing wallet:', address);
        setWalletAddress(address);
        return address;
      }
      console.log('[HomeScreen] No existing wallet, loading...');
      const pubkey = await wallet.loadWallet();
      if (pubkey) {
        const address = pubkey.toBase58();
        console.log('[HomeScreen] ✅ Wallet loaded:', address);
        setWalletAddress(address);
        return address;
      } else {
        console.log('[HomeScreen] ❌ wallet.loadWallet() returned null');
      }
    } catch (error) {
      console.error('[HomeScreen] ❌ Failed to ensure wallet', error);
    }
    return null;
  }, []);

  const loadBalances = useCallback(async () => {
    console.log('[HomeScreen] ========== loadBalances CALLED ==========');
    console.log('[HomeScreen] Current walletAddress state:', walletAddress);
    try {
      setLoading(true);
      console.log('[HomeScreen] Loading set to true');

      // Get wallet address - try from state first, then load
      let address = walletAddress;
      if (!address) {
        console.log('[HomeScreen] No address in state, loading wallet...');
        const pubkey = await wallet.loadWallet();
        if (pubkey) {
          address = pubkey.toBase58();
          console.log('[HomeScreen] Wallet loaded, address:', address);
          setWalletAddress(address);
        } else {
          console.log('[HomeScreen] ❌ wallet.loadWallet() returned null/undefined');
        }
      } else {
        console.log('[HomeScreen] Using address from state:', address);
      }

      if (!address) {
        throw new Error('Wallet not loaded');
      }

      console.log('[HomeScreen] Creating PublicKey from address:', address);
      const pubkey = new PublicKey(address);
      console.log('[HomeScreen] PublicKey created successfully');

      // Get both balances using reliable connection service with fallbacks
      console.log('[HomeScreen] Calling connectionService.getAllBalances...');
      const balances = await connectionService.getAllBalances(pubkey);
      console.log('[HomeScreen] ✅ getAllBalances returned:', balances);

      console.log('[HomeScreen] Setting SOL balance to:', balances.solBalance);
      setSolBalance(balances.solBalance);
      console.log('[HomeScreen] Setting USDC balance to:', balances.usdcBalance);
      setUsdcBalance(balances.usdcBalance);

      // Try to get escrow balance
      try {
        console.log('[HomeScreen] Attempting to fetch escrow balance...');
        const { BeamProgramClient } = require('../solana/BeamProgram');

        // Use existing connection from connectionService to avoid initialization issues
        const existingConnection = connectionService.getConnection();
        console.log('[HomeScreen] Got connection from connectionService');

        // Create read-only client with existing connection
        const readOnlyClient = new BeamProgramClient(existingConnection);
        console.log('[HomeScreen] BeamProgramClient created successfully');

        // Check if escrow account exists
        console.log('[HomeScreen] Calling getEscrowAccount...');
        const escrowAccount = await readOnlyClient.getEscrowAccount(pubkey);
        console.log('[HomeScreen] getEscrowAccount returned:', escrowAccount ? 'data' : 'null');

        if (escrowAccount) {
          console.log('[HomeScreen] ✅ Escrow account exists');
          setEscrowExists(true);
          const decimals = Config.tokens.usdc.decimals ?? 6;
          const scale = Math.pow(10, decimals);
          const escrowBalanceUsdc = escrowAccount.escrowBalance / scale; // Convert to USDC
          setEscrowBalance(escrowBalanceUsdc);
          console.log('[HomeScreen] ✅ Escrow balance fetched:', escrowBalanceUsdc, 'USDC');
        } else {
          console.log('[HomeScreen] Escrow account does not exist yet');
          setEscrowExists(false);
          setEscrowBalance(0);
        }
      } catch (escrowErr) {
        console.log('[HomeScreen] Could not fetch escrow balance:', escrowErr);
        console.log('[HomeScreen] Error type:', typeof escrowErr);
        console.log('[HomeScreen] Error message:', escrowErr instanceof Error ? escrowErr.message : String(escrowErr));
        console.log('[HomeScreen] Error stack:', escrowErr instanceof Error ? escrowErr.stack : 'No stack');

        // This is expected if the escrow account doesn't exist yet
        const errorMsg = escrowErr instanceof Error ? escrowErr.message : String(escrowErr);
        if (errorMsg.includes('Account does not exist') || errorMsg.includes('could not find account')) {
          console.log('[HomeScreen] Escrow account not initialized yet - showing 0 balance');
          setEscrowExists(false);
          setEscrowBalance(0);
        } else {
          console.error('[HomeScreen] Unexpected escrow fetch error:', errorMsg);
          setEscrowBalance(0);
        }
      }

      console.log('[HomeScreen] ✅ Balances loaded successfully:', {
        SOL: balances.solBalance,
        USDC: balances.usdcBalance,
        Escrow: escrowBalance,
      });
    } catch (error) {
      console.error('[HomeScreen] ❌ Failed to load balances:', error);
      console.error('[HomeScreen] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace',
      });
      // Keep previous balances on error instead of clearing
    } finally {
      console.log('[HomeScreen] Setting loading to false');
      setLoading(false);
      console.log('[HomeScreen] ========== loadBalances COMPLETED ==========');
    }
  }, [walletAddress]);

  // Removed useEffect - useFocusEffect already handles initial load and subsequent focus events

  useFocusEffect(
    useCallback(() => {
      console.log('[HomeScreen] useFocusEffect triggered');
      let active = true;
      (async () => {
        // Load wallet and balances when screen is focused
        console.log('[HomeScreen] Getting wallet pubkey for focus effect...');
        const pubkey = wallet.getPublicKey() || await wallet.loadWallet();
        if (!active || !pubkey) {
          console.log('[HomeScreen] Focus effect aborted:', { active, pubkey: !!pubkey });
          return;
        }
        console.log('[HomeScreen] Setting wallet address from focus effect:', pubkey.toBase58());
        setWalletAddress(pubkey.toBase58());
        console.log('[HomeScreen] Calling loadBalances from focus effect...');
        await loadBalances();
      })();
      return () => {
        console.log('[HomeScreen] Focus effect cleanup');
        active = false;
      };
    }, [loadBalances])
  );

  const handlePayMerchant = () => {
    navigation.navigate('CustomerDashboard');
  };

  const handleReceivePayment = () => {
    navigation.navigate('MerchantDashboard');
  };

  return (
    <Screen scrollable={true}>
      <View style={styles.container}>
        <Hero
          title="Beam Wallet"
          subtitle={walletAddress
            ? `Your wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`
            : 'Loading wallet keys...'}
        />

        {/* Wallet Balance Card */}
        <Card variant="glass" style={styles.balanceCard}>
          <Small style={styles.balanceLabel}>Available Balance</Small>
          {loading ? (
            <ActivityIndicator color={palette.primary} size="small" style={styles.loader} />
          ) : (
            <View>
              <View style={styles.balanceRow}>
                <View style={styles.balanceItem}>
                  <HeadingM style={styles.balanceAmount}>
                    {solBalance !== null ? solBalance.toFixed(4) : '0.0000'} SOL
                  </HeadingM>
                </View>
                <View style={styles.balanceDivider} />
                <View style={styles.balanceItem}>
                  <HeadingM style={styles.balanceAmount}>
                    {usdcBalance !== null ? usdcBalance.toFixed(2) : '0.00'} USDC
                  </HeadingM>
                </View>
              </View>

              {/* Escrow Balance Section */}
              <View style={styles.escrowSection}>
                <View style={styles.escrowHeader}>
                  <Small style={styles.escrowLabel}>Escrow Balance</Small>
                  {!escrowExists && (
                    <Small style={styles.escrowHint}>(Not initialized)</Small>
                  )}
                </View>
                <Body style={styles.escrowBalance}>
                  🔒 {escrowBalance.toFixed(2)} USDC
                </Body>
              </View>
            </View>
          )}
          <Button
            label="Refresh balances"
            variant="secondary"
            onPress={loadBalances}
            style={styles.refreshButton}
          />
        </Card>

        <View style={styles.content}>
          <Card style={styles.actionCard}>
            <View style={styles.cardHeader}>
              <HeadingM>💸 Pay a Merchant</HeadingM>
              <Small style={styles.cardDescription}>
                Scan merchant QR codes and make offline payments with USDC
              </Small>
            </View>
            <View style={styles.featureList}>
              <Body style={styles.feature}>• Create escrow for secure payments</Body>
              <Body style={styles.feature}>• Pay offline via mesh network</Body>
              <Body style={styles.feature}>• Transactions settle when online</Body>
            </View>
            <Button
              label="Go to Customer Dashboard"
              onPress={handlePayMerchant}
            />
          </Card>

          <Card style={styles.actionCard}>
            <View style={styles.cardHeader}>
              <HeadingM>💰 Receive Payments</HeadingM>
              <Small style={styles.cardDescription}>
                Accept payments from customers via QR codes and mesh network
              </Small>
            </View>
            <View style={styles.featureList}>
              <Body style={styles.feature}>• Generate payment QR codes</Body>
              <Body style={styles.feature}>• Receive payments offline</Body>
              <Body style={styles.feature}>• Settle payments when online</Body>
            </View>
            <Button
              label="Go to Merchant Dashboard"
              variant="secondary"
              onPress={handleReceivePayment}
            />
          </Card>
        </View>

        <Card variant="glass" style={styles.infoCard}>
          <Small style={styles.infoText}>
            You can switch between customer and merchant modes anytime. Your wallet address remains the same for both roles.
          </Small>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.xl,
  },
  balanceCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  balanceLabel: {
    color: palette.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  loader: {
    marginVertical: spacing.md,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  balanceItem: {
    flex: 1,
    alignItems: 'center',
  },
  balanceDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(148,163,184,0.2)',
  },
  balanceAmount: {
    color: palette.textPrimary,
    fontSize: 18,
  },
  refreshButton: {
    marginTop: spacing.xs,
  },
  escrowSection: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
  },
  escrowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  escrowLabel: {
    color: palette.textSecondary,
    fontSize: 12,
  },
  escrowHint: {
    color: 'rgba(148,163,184,0.6)',
    fontSize: 11,
    fontStyle: 'italic',
  },
  escrowBalance: {
    color: palette.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    gap: spacing.lg,
    flex: 1,
  },
  actionCard: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  cardHeader: {
    gap: spacing.sm,
  },
  cardDescription: {
    color: palette.textSecondary,
  },
  featureList: {
    gap: spacing.xs,
  },
  feature: {
    color: 'rgba(148,163,184,0.9)',
    fontSize: 14,
  },
  infoCard: {
    padding: spacing.lg,
  },
  infoText: {
    color: 'rgba(148,163,184,0.8)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
