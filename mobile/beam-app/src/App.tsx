import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UiPreferencesProvider } from './ui/UiPreferencesContext';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { WalletCreationScreen } from './screens/WalletCreationScreen';
import { WalletImportScreen } from './screens/WalletImportScreen';
import { FundingScreen } from './screens/FundingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { WalletBackupScreen } from './screens/WalletBackupScreen';
import { WalletQRScreen } from './screens/WalletQRScreen';
import { TransactionsScreen } from './screens/TransactionsScreen';
import { TransactionDetailsScreen } from './screens/TransactionDetailsScreen';
import { EscrowSetupScreen } from './screens/EscrowSetupScreen';
import { CustomerScreen } from './screens/CustomerScreen';
import { MerchantScreen } from './screens/MerchantScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { wallet } from './wallet/WalletManager';
import { connectionService } from './services/ConnectionService';
import { attestationQueue } from './services/AttestationQueue';

export type RootStackParamList = {
  Welcome: undefined;
  WalletCreation: undefined;
  WalletImport: undefined;
  WalletBackup: undefined;
  WalletQR: undefined;
  Transactions: undefined;
  TransactionDetails: { id: string };
  Funding: undefined;
  Home: undefined;
  EscrowSetup: undefined;
  CustomerDashboard: undefined;
  MerchantDashboard: undefined;
  Settings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const WALLET_FUNDED_KEY = '@beam:wallet_funded';
const WALLET_BACKED_UP_KEY = '@beam:wallet_backed_up';

export default function App() {
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      // Phase 1.4: Start attestation queue processing
      attestationQueue.startProcessing();
      console.log('[App] Attestation queue started');

      // Load RPC override if present
      try {
        const override = await AsyncStorage.getItem('@beam:rpc_override');
        if (override) connectionService.setRpcOverride(override);
      } catch {}

      // Check if wallet exists in secure storage
      const walletExists = await wallet.loadWallet();

      if (!walletExists) {
        // No wallet - show welcome screen
        setInitialRoute('Welcome');
        return;
      }

      // Wallet exists - ensure backup completed first
      const backedUp = await AsyncStorage.getItem(WALLET_BACKED_UP_KEY);
      if (backedUp !== 'true') {
        setInitialRoute('WalletBackup');
        return;
      }

      // Then check if it's been funded
      const walletFunded = await AsyncStorage.getItem(WALLET_FUNDED_KEY);

      if (walletFunded === 'true') {
        // Wallet funded - go to Home where user can choose customer or merchant role
        if (__DEV__) {
          console.log('[App] Wallet exists and funded, showing Home screen');
        }
        setInitialRoute('Home');
      } else {
        // Wallet exists but not funded - resume at funding
        if (__DEV__) {
          console.log('[App] Wallet exists, needs funding');
        }
        setInitialRoute('Funding');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[App] Failed to initialize:', error);
      }
      // On error, default to Welcome screen
      setInitialRoute('Welcome');
    }
  }

  // Show loading screen while initializing
  if (initialRoute === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020617' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <UiPreferencesProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            cardStyle: { backgroundColor: '#020617' },
          }}
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="WalletCreation" component={WalletCreationScreen} />
          <Stack.Screen name="WalletImport" component={WalletImportScreen} />
          <Stack.Screen name="WalletBackup" component={WalletBackupScreen} />
          <Stack.Screen name="WalletQR" component={WalletQRScreen} />
          <Stack.Screen name="Transactions" component={TransactionsScreen} />
          <Stack.Screen name="TransactionDetails" component={TransactionDetailsScreen} />
          <Stack.Screen name="Funding" component={FundingScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="EscrowSetup" component={EscrowSetupScreen} />
          <Stack.Screen name="CustomerDashboard" component={CustomerScreen} />
          <Stack.Screen name="MerchantDashboard" component={MerchantScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      </UiPreferencesProvider>
    </ErrorBoundary>
  );
}
