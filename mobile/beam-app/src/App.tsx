import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { WalletCreationScreen } from './screens/WalletCreationScreen';
import { FundingScreen } from './screens/FundingScreen';
import { EscrowSetupScreen } from './screens/EscrowSetupScreen';
import { CustomerScreen } from './screens/CustomerScreen';
import { MerchantScreen } from './screens/MerchantScreen';

export type RootStackParamList = {
  Welcome: undefined;
  WalletCreation: { role: 'customer' | 'merchant' };
  Funding: { role: 'customer' | 'merchant' };
  EscrowSetup: { role: 'customer' };
  CustomerDashboard: undefined;
  MerchantDashboard: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#020617' },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="WalletCreation" component={WalletCreationScreen} />
        <Stack.Screen name="Funding" component={FundingScreen} />
        <Stack.Screen name="EscrowSetup" component={EscrowSetupScreen} />
        <Stack.Screen name="CustomerDashboard" component={CustomerScreen} />
        <Stack.Screen name="MerchantDashboard" component={MerchantScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
