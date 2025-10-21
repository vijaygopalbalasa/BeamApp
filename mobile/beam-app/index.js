// POLYFILLS MUST COME FIRST - DO NOT MOVE THESE IMPORTS
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';

// Set global Buffer
global.Buffer = global.Buffer || Buffer;

// React Native and App imports MUST come after polyfills
import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
