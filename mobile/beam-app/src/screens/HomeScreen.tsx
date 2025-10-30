import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../config';
import { BeamProgramClient } from '../solana/BeamProgram';
import { BalanceCard } from '../components/features/BalanceCard';
import { NetworkStatus } from '../components/features/NetworkStatus';
import { transactionHistory, type TransactionItem } from '../services/TransactionHistoryService';
import { Skeleton } from '../components/ui/Skeleton';
import { InfoButton } from '../components/ui/InfoButton';
import { haptics } from '../utils/haptics';
import { TransactionCard } from '../components/features/TransactionCard';

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
  const [health, setHealth] = useState<{ rpc: boolean; program: boolean }>({ rpc: false, program: false });
  const [, setBackedUp] = useState<boolean>(false);
  const [healthUpdatedAt, setHealthUpdatedAt] = useState<number>(0);
  const [balancesUpdatedAt, setBalancesUpdatedAt] = useState<number>(0);
  const [recent, setRecent] = useState<TransactionItem[]>([]);
  const [recentLoading, setRecentLoading] = useState<boolean>(true);

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
        const pubkey = wallet.getPublicKey() || await wallet.loadWallet();
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

      // Health check: quick RPC and program status + backup flag
      try {
        const conn = connectionService.getConnection();
        await conn.getSlot('processed');
        const client = new BeamProgramClient(conn);
        const status = await client.testConnection();
        setHealth({ rpc: status.connected, program: status.programExists });
        setHealthUpdatedAt(Date.now());
        const bu = await AsyncStorage.getItem('@beam:wallet_backed_up');
        setBackedUp(bu === 'true');
      } catch {
        setHealth({ rpc: false, program: false });
      }

      // Get both balances using reliable connection service with fallbacks
      console.log('[HomeScreen] Calling connectionService.getAllBalances...');
      const balances = await connectionService.getAllBalances(pubkey);
      console.log('[HomeScreen] ✅ getAllBalances returned:', balances);

      console.log('[HomeScreen] Setting SOL balance to:', balances.solBalance);
      setSolBalance(balances.solBalance);
      console.log('[HomeScreen] Setting USDC balance to:', balances.usdcBalance);
      setUsdcBalance(balances.usdcBalance);
      setBalancesUpdatedAt(Date.now());

      // Try to get escrow balance
      try {
        console.log('[HomeScreen] Attempting to fetch escrow balance...');
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

      // Load recent activity
      try {
        setRecentLoading(true);
        const items = await transactionHistory.loadRecent(5);
        setRecent(items);
      } catch (e) {
        console.log('[HomeScreen] Recent activity load failed', e);
      } finally {
        setRecentLoading(false);
      }
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
  }, [walletAddress, escrowBalance]);

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

        <BalanceCard
          sol={solBalance}
          usdc={usdcBalance}
          escrow={escrowBalance}
          loading={loading}
          updatedAt={balancesUpdatedAt}
          refreshButton={
            <Button label="Refresh balances" variant="secondary" onPress={() => { haptics.light(); loadBalances(); }} style={styles.refreshButton} />
          }
        />

        {/* Health Card */}
        <Card variant="glass" style={styles.infoCard}>
          <NetworkStatus online={health.rpc} program={health.program} updatedAt={healthUpdatedAt} />
        </Card>

        {/* Quick Actions */}
        <Card style={styles.quickActions}>
          <Button label="Pay" onPress={handlePayMerchant} style={styles.quickBtn} />
          <Button label="Receive" variant="secondary" onPress={handleReceivePayment} style={styles.quickBtn} />
          <Button label={escrowExists ? 'Escrow' : 'Init Escrow'} variant="secondary" onPress={() => navigation.navigate('EscrowSetup')} style={styles.quickBtn} />
        </Card>

        {/* Recent Activity */}
        <Card style={styles.actionCard}>
          <View style={[styles.cardHeader, { alignItems: 'center' }]}>
            <HeadingM>Recent Activity</HeadingM>
            <InfoButton title="What is this?" message="Your latest payments appear here. Tap any item for details." />
            {recent.length > 0 && (
              <Button label="View All" variant="secondary" onPress={() => navigation.navigate('Transactions')} />
            )}
          </View>
          <View>
            {recentLoading ? (
              <View>
                {[0, 1, 2].map(i => (
                  <View key={i} style={{ paddingVertical: 12 }}>
                    <Skeleton height={20} width={'60%'} />
                    <Skeleton height={14} width={'40%'} style={{ marginTop: 6 }} />
                  </View>
                ))}
              </View>
            ) : recent.length === 0 ? (
              <Small style={{ color: 'rgba(148,163,184,0.8)' }}>No recent activity</Small>
            ) : (
              recent.map(item => (
                <TransactionCard key={item.id} item={item} onPress={(id) => navigation.navigate('TransactionDetails', { id })} />
              ))
            )}
          </View>
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
          <Button
            label="Open Settings"
            variant="secondary"
            onPress={() => navigation.navigate('Settings')}
            style={{ marginTop: spacing.sm }}
          />
        </Card>

        {/* Removed checklist for simplified Home UI */}
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
  updatedAt: {
    marginTop: spacing.xs,
    color: 'rgba(148,163,184,0.7)',
    textAlign: 'center',
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
  checklistCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  checklist: {
    gap: spacing.xs,
  },
  checkItem: {
    color: palette.textPrimary,
  },
  checklistActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  quickActions: {
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  quickBtn: {
    flex: 1,
  },
});
