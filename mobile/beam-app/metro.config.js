const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    extraNodeModules: {
      '@beam/shared': path.resolve(workspaceRoot, 'mobile/shared'),
      buffer: path.resolve(projectRoot, 'node_modules/@craftzdog/react-native-buffer'),
      crypto: path.resolve(projectRoot, 'node_modules/crypto-browserify'),
      process: path.resolve(projectRoot, 'node_modules/process/browser'),
      stream: path.resolve(projectRoot, 'node_modules/stream-browserify'),
      util: path.resolve(projectRoot, 'node_modules/util'),
      vm: path.resolve(projectRoot, 'node_modules/vm-browserify'),
    },
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
