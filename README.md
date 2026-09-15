# claude-notification

Know what your Claude Code sessions are doing without walking back to the Mac.

A launchd daemon watches every local session, and notifies when one starts waiting on you or
finishes — as a banner on the Mac itself, and as a push to your phone. An Expo Android app
shows the live list; the iPhone gets the same alerts through the free
[ntfy](https://ntfy.sh) app.

```
 sessions on the Mac ──► claude agents --json ──► daemon ──┬──► macOS banner ──► this Mac
                                                           ├──► Expo push    ──► Android app
                                                           ├──► ntfy         ──► iPhone
                                                           └──► GET /status  ──► Android app
                                                                (over Tailscale)
```

The macOS banners need no setup at all — `node-notifier` ships the notifier binary, so there
is nothing to install and no Tailscale or phone involved. If you only want notifications on
the Mac, steps 2 and 3 below are optional.

## Before you build anything, try the built-in one

Claude Code already ships most of this and it costs nothing:

1. Run `/remote-control` in a session on the Mac.
2. `/config` → enable **Push when Claude decides** and **Push when actions required**.
3. Install the Claude app on your phones, same account, open the **Code** tab.

That gives you one account across devices, live status, and push. This project exists for
what it does not do: **one consolidated list of every local session**, and alerts that fire
on rules you choose rather than when Claude judges it worth interrupting you.

## Setup

### 1. The daemon

```bash
npm install
npm run build
npm run cli -- init      # writes ~/.config/claude-notification/config.json
npm run cli -- status    # sanity check: should list your live sessions
```

Check the banners work before anything else — this needs no phone and no network:

```bash
npm run cli -- test-notify
```

macOS may ask you to allow notifications the first time; if no banner appears, look for
**terminal-notifier** in **System Settings → Notifications** and enable it.

Run it in the foreground:

```bash
npm run daemon
```

Once you are happy, install it as a login agent:

```bash
./scripts/install-launchd.sh
tail -f ~/Library/Logs/claude-notification.log
```

### 2. Tailscale

Install Tailscale on the Mac and the Android phone and sign both into the same tailnet. The
daemon binds only to the mesh address — it is never exposed on whatever network you happen
to be on. Check it resolved:

```bash
npm run cli -- token     # prints the token and the daemon URL
```

### 3. The Android app

```bash
./scripts/setup-app.sh       # scaffolds against the current Expo SDK and installs
cd packages/app
npx eas init                 # creates the project id push needs
npx eas build --profile development --platform android
```

`setup-app.sh` is safe to re-run; it skips the scaffold once `package.json` exists but always
reconciles dependencies. To check the app compiles without a device:

```bash
cd packages/app && npx tsc --noEmit && npx expo export --platform android
```

Install that build on the phone — **Expo Go cannot receive Android push notifications**, so a
development build is required. Open the app, put the daemon URL and token into Settings, and
hit **Test connection**: that registers the device for push and proves the whole path.

### 4. The iPhone (optional)

Enable the ntfy transport in the config, subscribe to the topic that `cli init` generated in
the [ntfy app](https://ntfy.sh). No build, no Apple developer account.

## Configuration

`~/.config/claude-notification/config.json`:

| Key | Default | Notes |
|---|---|---|
| `pollIntervalMs` | `5000` | `claude agents --json` costs ~0.2s per call |
| `debounceMs` | `3000` | how long a status must hold before it notifies |
| `redactPaths` | `true` | send only the folder name, never the full path |
| `server.bind` | `"tailscale"` | or `"loopback"`, or an explicit IP. Never `0.0.0.0` |
| `rules.needsInput` | `true` | a session started waiting on you |
| `rules.finished` | `true` | a session went idle |
| `rules.started` | `false` | a session went busy — usually just you typing |
| `rules.disappeared` | `false` | a session vanished — usually just you quitting |
| `transports.macos.enabled` | `true` | banners on this Mac |
| `transports.macos.activateBundleId` | `null` | app to focus on click, e.g. `com.googlecode.iterm2` |
| `transports.ntfy.enabled` | `false` | turn on for the iPhone |

Secrets come from the environment, never the file: `CLAUDE_NOTIFY_AUTH_TOKEN`,
`CLAUDE_NOTIFY_NTFY_TOKEN`. If you do not set the first one, the daemon generates one on
first run and keeps it in `~/.local/state/claude-notification/state.json` (mode 600).

> **ntfy topics are public to anyone who knows the name.** `cli init` generates a random one —
> keep it out of screenshots, and leave `redactPaths` on. The Expo and Tailscale paths are
> private; ntfy is not.

## Troubleshooting

```bash
npm run cli -- status                     # can the daemon see your sessions at all?
npm run cli -- test-notify                # does a Mac banner appear? (no phone needed)
curl http://<tailscale-name>:8787/health  # is the daemon up? (no auth needed)
tail -f ~/Library/Logs/claude-notification.log
```

If the app says it cannot reach the daemon, check Tailscale is connected on **both** devices
before anything else — that is nearly always it.

## What this does not do

- **Cloud/web sessions.** There is no supported API to enumerate sessions that are not on
  this machine. Use the official Claude app for those.
- **Replying or approving from the phone.** Watch-only by design; Remote Control does that.
- **Running Claude Code on a phone.** Not possible — agents run on the Mac.
