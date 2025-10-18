module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
    },
    android: {
      sourceDir: './android',
    },
  },
  dependencies: {
    'react-native-ble-plx': {
      platforms: {
        ios: {},
        android: {},
      },
    },
    'react-native-vision-camera': {
      platforms: {
        ios: {},
        android: {},
      },
    },
    'react-native-keychain': {
      platforms: {
        ios: {},
        android: {},
      },
    },
    '@react-native-async-storage/async-storage': {
      platforms: {
        ios: {},
        android: {},
      },
    },
  },
  assets: ['./assets/fonts/'],
};
