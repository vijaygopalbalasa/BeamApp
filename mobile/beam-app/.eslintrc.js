const path = require('path');

// Allow resolving shared dependencies from the workspace root when pnpm keeps them hoisted
module.paths.push(path.resolve(__dirname, '../../node_modules'));

const baseConfig = require('@react-native/eslint-config');

const overrides = (baseConfig.overrides || []).map(override => {
  if (!override?.env || !override.env['jest/globals']) {
    return override;
  }

  const { ['jest/globals']: _removed, ...restEnv } = override.env;
  return {
    ...override,
    env: {
      ...restEnv,
      jest: true,
    },
  };
});

module.exports = {
  ...baseConfig,
  root: true,
  extends: (baseConfig.extends || []).filter(entry => entry !== 'prettier'),
  ignorePatterns: ['dist/', 'android/', 'ios/'],
  overrides,
  rules: {
    ...baseConfig.rules,
    '@typescript-eslint/func-call-spacing': 'off',
    curly: ['error', 'multi-line'],
    'no-void': 'off',
  },
};
