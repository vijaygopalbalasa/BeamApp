// Global Solana polyfills MUST be loaded first
import './src/polyfills/solana';

// React Native and App imports MUST come after polyfills
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
