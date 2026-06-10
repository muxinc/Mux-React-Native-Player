const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
const singletonModules = [
  'expo',
  'expo-modules-core',
  'react',
  'react-native',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
];

config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), repoRoot])
);

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@mux/mux-react-native-player': repoRoot,
  expo: path.resolve(projectRoot, 'node_modules/expo'),
  'expo-modules-core': path.resolve(projectRoot, 'node_modules/expo-modules-core'),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonModules.includes(moduleName) || moduleName.startsWith('react-native/')) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }

  if (
    moduleName === '../Promise' &&
    context.originModulePath.endsWith('react-native/Libraries/Core/polyfillPromise.js')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'metro-shims/react-native-promise.js'),
    };
  }

  if (
    moduleName === '../promiseRejectionTrackingOptions' &&
    context.originModulePath.endsWith('react-native/Libraries/Core/polyfillPromise.js')
  ) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(
        projectRoot,
        'metro-shims/react-native-promise-rejection-tracking-options.js'
      ),
    };
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
