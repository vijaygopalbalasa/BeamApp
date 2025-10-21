import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import App from './src/App';
import {name as appName} from './app.json';
import {Buffer} from 'buffer';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

AppRegistry.registerComponent(appName, () => App);
