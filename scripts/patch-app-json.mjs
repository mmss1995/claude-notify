/**
 * Adds the bits of app.json that this app needs on top of the Expo baseline:
 * expo-router, an Android package name, and the notification permission.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: patch-app-json.mjs <app.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(path, 'utf8'));
const expo = manifest.expo ?? (manifest.expo = {});

expo.name = 'Claude Sessions';
expo.slug = 'claude-notification';
// expo-router requires a scheme for deep links.
expo.scheme = 'ccn';
expo.userInterfaceStyle = 'dark';
expo.plugins = [...new Set([...(expo.plugins ?? []), 'expo-router', 'expo-notifications'])];

expo.android = {
  ...expo.android,
  package: 'it.codeland.claudenotification',
  permissions: [...new Set([...(expo.android?.permissions ?? []), 'POST_NOTIFICATIONS'])],
};

writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('patched', path);
