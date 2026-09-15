const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// @ccn/shared lives outside this project, so Metro has to be told to watch it.
// The shared package points its "react-native" field at src/index.ts, which
// means the app consumes the TypeScript directly - no build step to forget.
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  '@ccn/shared': path.resolve(workspaceRoot, 'packages/shared'),
};
// Without this, Metro walks up and can resolve two copies of react.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
