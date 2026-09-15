#!/bin/bash
# Installs the daemon as a per-user launchd agent so it starts at login and
# restarts if it dies. Re-runnable: it unloads any previous copy first.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.matteosausto.claude-notification"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/claude-notification.log"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi

# launchd gives an agent a minimal PATH, so `claude` and `node` must be findable
# by absolute path or via an explicitly set PATH.
CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ]; then
  echo "claude not found on PATH - the daemon would have nothing to poll" >&2
  exit 1
fi
AGENT_PATH="$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO/packages/daemon/dist/daemon.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$AGENT_PATH</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

if [ ! -f "$REPO/packages/daemon/dist/daemon.js" ]; then
  echo "note: packages/daemon/dist/daemon.js does not exist yet - run 'npm run build' first" >&2
fi

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Loaded $LABEL"
echo "  plist: $PLIST"
echo "  log:   $LOG"
echo
echo "Check it with:  launchctl list | grep claude-notification"
echo "Follow the log: tail -f $LOG"
echo "Remove it with: launchctl unload $PLIST && rm $PLIST"
