#!/bin/bash
# Scaffolds the Expo project in packages/app without clobbering the source that
# already lives there.
#
# Expo SDK versions move fast and each one pins its own React Native, so rather
# than hard-coding versions that would rot, this generates a fresh baseline with
# create-expo-app and then layers our app/ and src/ on top.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../packages/app" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -f "$APP_DIR/package.json" ]; then
  echo "packages/app/package.json already exists - nothing to scaffold."
  echo "To re-scaffold, move it aside first."
  exit 0
fi

echo "Generating an Expo baseline (this downloads the current SDK)..."
npx --yes create-expo-app@latest "$TMP/baseline" --template blank-typescript --no-install

# Take only the generated project scaffolding; our screens and logic stay put.
for f in package.json app.json tsconfig.json babel.config.js .gitignore; do
  [ -f "$TMP/baseline/$f" ] && cp "$TMP/baseline/$f" "$APP_DIR/$f"
done
[ -d "$TMP/baseline/assets" ] && cp -R "$TMP/baseline/assets" "$APP_DIR/assets"

# create-expo-app's blank template ships App.tsx; expo-router uses app/ instead.
rm -f "$APP_DIR/App.tsx"

node "$(dirname "${BASH_SOURCE[0]}")/patch-app-package.mjs" "$APP_DIR/package.json"
node "$(dirname "${BASH_SOURCE[0]}")/patch-app-json.mjs" "$APP_DIR/app.json"

cd "$APP_DIR"
echo "Installing the packages this app needs, at versions matching the SDK..."
npx --yes expo install \
  expo-router expo-notifications expo-device expo-constants expo-status-bar \
  react-native-safe-area-context react-native-screens \
  @react-native-async-storage/async-storage

echo
echo "Done. Next:"
echo "  1. cd packages/app && npx eas init      # creates the EAS project id push needs"
echo "  2. npx eas build --profile development --platform android"
echo "  3. Install that build on the phone (Expo Go cannot receive Android push)"
