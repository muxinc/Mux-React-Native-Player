const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// Resolve the installed entry (build/index.js), including workspace symlinks.
// Watch only library inputs, not the repository's generated native/build trees.
const libraryRoot = path.dirname(path.dirname(require.resolve('@mux/mux-react-native-player')));
config.watchFolders = [...new Set([
  ...(config.watchFolders ?? []),
  path.join(libraryRoot, 'src'),
  path.join(libraryRoot, 'assets'),
])];

module.exports = config;
