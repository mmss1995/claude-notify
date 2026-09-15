#!/bin/bash
# Scaffolds the Expo project in packages/app without clobbering the source that
# already lives there.
#
# Expo SDK versions move fast and each one pins its own React Native, so rather
# than hard-coding versions that would rot, this generates a fresh baseline with
# create-expo-app and then layers our app/ and src/ on top.
#
# Safe to re-run: the baseline step is skipped once package.json exists, but the
# dependency steps always run, so an interrupted setup can be finished by
# running this again.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../packages/app" && pwd)"

# Packages this app needs on top of the blank template. `expo install` picks the
# version matching the installed SDK rather than the latest on npm.
EXTRA_DEPS=(
  expo-router
  # expo-router/entry imports this, but installing expo-router does not pull it
  # in - without it Metro fails with "Unable to resolve module @expo/metro-runtime".
  @expo/metro-runtime
  expo-notifications
  expo-device
  expo-constants
  expo-status-bar
  react-native-safe-area-context
  react-native-screens
  @react-native-async-storage/async-storage
)

if [ ! -f "$APP_DIR/package.json" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  echo "==> Generating an Expo baseline (this downloads the current SDK)..."
  npx --yes create-expo-app@latest "$TMP/baseline" --template blank-typescript --no-install

  # Take only the generated project scaffolding; our screens and logic stay put.
  for f in package.json app.json tsconfig.json babel.config.js .gitignore; do
    [ -f "$TMP/baseline/$f" ] && cp "$TMP/baseline/$f" "$APP_DIR/$f"
  done
  [ -d "$TMP/baseline/assets" ] && cp -R "$TMP/baseline/assets" "$APP_DIR/assets"

  # create-expo-app's blank template ships App.tsx; expo-router uses app/ instead.
  rm -f "$APP_DIR/App.tsx"

  node "$SCRIPT_DIR/patch-app-package.mjs" "$APP_DIR/package.json"
  node "$SCRIPT_DIR/patch-app-json.mjs" "$APP_DIR/app.json"
else
  echo "==> packages/app/package.json exists - skipping the baseline step."
fi

cd "$APP_DIR"

# This has to happen before `expo install`: that command reads the SDK version
# out of the installed `expo` module, and fails with a ConfigError if node_modules
# is missing. The baseline is generated with --no-install, so without this step
# every extra dependency is silently skipped.
echo "==> Installing the baseline dependencies..."
npm install

echo "==> Adding the packages this app needs, at versions matching the SDK..."
npx --yes expo install "${EXTRA_DEPS[@]}"

# `expo install` has been seen to print a ConfigError and still exit 0, which
# would leave a half-built project looking like a success. Verify instead of
# trusting the exit code.
echo "==> Verifying..."
MISSING=()
for dep in "${EXTRA_DEPS[@]}"; do
  node -e "
    const pkg = require('$APP_DIR/package.json');
    process.exit(pkg.dependencies?.['$dep'] ? 0 : 1);
  " || MISSING+=("$dep")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo >&2
  echo "ERROR: these packages were not added to package.json:" >&2
  printf '  %s\n' "${MISSING[@]}" >&2
  echo >&2
  echo "Run 'npx expo install ${MISSING[*]}' in packages/app and check the output." >&2
  exit 1
fi

echo
echo "All dependencies present. Next:"
echo "  1. cd packages/app && npx eas init      # creates the EAS project id push needs"
echo "  2. npx eas build --profile development --platform android"
echo "  3. Install that build on the phone (Expo Go cannot receive Android push)"
