const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// @ccn/shared lives outside this project, so Metro has to be told to watch it.
// The shared package exposes a "react-native" export condition pointing at
// src/index.ts, so the app consumes the TypeScript source and there is no build
// step to forget when the wire contract changes.
config.watchFolders = [path.resolve(workspaceRoot, 'packages/shared')];

config.resolver.extraNodeModules = {
  '@ccn/shared': path.resolve(workspaceRoot, 'packages/shared'),
};

// Deliberately NOT setting disableHierarchicalLookup or nodeModulesPaths here.
// This project is not an npm workspace member - it has its own complete
// node_modules - and several Expo packages are nested rather than hoisted
// (expo-asset lives in node_modules/expo/node_modules). Disabling the upward
// walk makes Metro fail to resolve them.

module.exports = config;
