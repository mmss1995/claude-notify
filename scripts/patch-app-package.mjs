/**
 * Adjusts the generated Expo package.json for this repo: adds the shared types
 * package and expo-router's entry point. Kept separate from setup-app.sh so the
 * JSON edit is not a fragile sed.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: patch-app-package.mjs <package.json>');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path, 'utf8'));

pkg.name = 'ccn-app';
// expo-router owns the entry point; the blank template points at App.tsx.
pkg.main = 'expo-router/entry';

pkg.dependencies = {
  ...pkg.dependencies,
  // Not a workspace member: the root install stays small and free of the RN
  // dependency tree. A file: dependency symlinks it just the same.
  '@ccn/shared': 'file:../shared',
};

// expo-router pulls in @expo/ui, which pulls Radix, which needs react-dom. npm
// otherwise resolves the newest react-dom, whose peer demands a newer react than
// the SDK pins - an ERESOLVE failure on a clean install. Pinning react-dom to the
// project's own react version settles it without --legacy-peer-deps.
if (pkg.dependencies?.react) {
  pkg.overrides = { ...pkg.overrides, 'react-dom': pkg.dependencies.react };
}

pkg.scripts = {
  ...pkg.scripts,
  start: 'expo start --dev-client',
  android: 'expo run:android',
  'build:dev': 'eas build --profile development --platform android',
  'build:apk': 'eas build --profile preview --platform android',
};

writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('patched', path);
