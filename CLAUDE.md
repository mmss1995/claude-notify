# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A macOS daemon that watches local Claude Code sessions and reports status changes
(`busy` / `waiting` / `idle`) as banners on the Mac and pushes to a phone, plus an Expo
React Native Android app that displays them. Sessions run on the Mac; the app only observes.

## Commands

```bash
npm install                  # root workspace (shared + daemon only)
npm run build                # tsc both workspace packages
npm test                     # vitest, daemon only
npm run typecheck            # tsc --noEmit across both packages

npm test -- diff             # single test file (positional filter passes through)
npm -w @ccn/daemon run test -- -t "flapped"   # single test case; the -t flag
                             # only survives the workspace-scoped invocation,
                             # not `npm test --`

npm run cli -- init          # write starter config + random ntfy topic
npm run cli -- token         # print the bearer token the app needs
npm run cli -- status        # list sessions the daemon can currently see
npm run cli -- once          # one poll, report what it would notify (sends nothing)
npm run cli -- once --send   # same, but actually deliver
npm run cli -- test-notify   # synthetic notification down every transport

npm run daemon               # run in the foreground (tsx, no build needed)
./scripts/install-launchd.sh # install as a login agent (needs `npm run build` first)
./scripts/setup-app.sh       # scaffold packages/app against the current Expo SDK
```

## Architecture

Data flows one way: **sources → merge → diff → debounce → rules → transports**, driven by
`core/poller.ts`, which is the only place those pieces meet. Everything it calls is pure
and unit-tested; the poller itself owns all the I/O.

- `sources/` produce `SessionSnapshot[]`. `localCli.ts` shells out to `claude agents --json`
  and is authoritative. `localFiles.ts` is a *`SessionEnricher`*, not a source — a separate
  interface precisely because it must never be load-bearing.
- `core/diff.ts` → `core/debounce.ts` → `core/rules.ts` are pure functions over snapshots.
  Change behaviour here, not in the poller.
- `notify/transport.ts` is the `Transport` interface; `macos.ts` (banners on this machine),
  `expo.ts` (Android app) and `ntfy.ts` (iPhone, which has no custom build) all implement it
  and are dispatched concurrently by the poller.
- `packages/shared` holds the wire types. The daemon imports the built `dist`; the app
  imports `src/index.ts` directly via the package's `react-native` field, so there is no
  build step to forget when changing the contract.

### Things that will bite you

**`claude agents --json` is the supported surface. `~/.claude/sessions/<pid>.json` is not.**
The latter is internal Claude Code state and is the *only* place `waitingFor` appears, which
is why it is read at all. Every failure path there must degrade silently to localCli-only.
The published docs describe `state` and `waitingFor` on the CLI output; measured against
2.1.270 they are absent. Trust the fixtures in `test/fixtures/`, not the docs.

**The status enum is open.** `SessionStatus` is `KnownSessionStatus | (string & {})`. Never
write an exhaustive switch without a default — a future release inventing a status must pass
through quietly, not crash the daemon or fire an uninterpretable notification.

**A tick where every source failed is abandoned, not diffed.** See the `anySourceSucceeded`
guard in `poller.ts`. Without it a transient CLI failure reads as every session vanishing at
once, firing bogus alerts and destroying the baseline. There is a test for this; keep it.

**The HTTP server must never bind `0.0.0.0`.** `server/tailscale.ts` resolves the mesh
address (100.64.0.0/10) and `resolveBindAddress` throws on a request to bind everything.
The daemon serves session metadata, and the laptop is regularly on client networks.

**`redactPaths` defaults to true because ntfy topics are public.** Session cwds carry client
names. `folder` (basename) is always sent; `cwd` is null unless redaction is off.

**Notification rules default conservative.** `appeared` never notifies (otherwise every
daemon restart buzzes for every live session) and `started` is off (that is just you typing).

**Expo `channelId` must stay `session-status`** in both `notify/expo.ts` and
`src/notifications.ts`, or high-priority Android alerts arrive silently.

**node-notifier forwards every own property as a CLI flag.** `constructArgumentList` is
called without an allow-list, so `activate: undefined` becomes the literal
`-activate "undefined"` and terminal-notifier answers with non-JSON that then fails to parse.
Optional keys must be *absent*, not undefined — see `MacPayload` in `notify/macos.ts`.
For the same reason silence is `sound: false` (which node-notifier deletes), not `undefined`.

**`timeout: false` on macOS notifications is load-bearing.** node-notifier otherwise applies
a default 10s timeout and its callback does not fire until the helper exits — measured at
10.3s per banner versus 0.3s without. The poller awaits dispatch, so that stalls the whole
poll loop.

### Conventions

- ESM with `"moduleResolution": "NodeNext"` — **relative imports need the `.js` extension**
  even from `.ts` files.
- `packages/app` is deliberately **outside** the npm workspace so the root install stays free
  of the React Native dependency tree. It links `@ccn/shared` via `file:../shared` and needs
  `npm install` run inside it separately.
- Expo SDK versions are not pinned in this repo. `scripts/setup-app.sh` generates the
  baseline with `create-expo-app@latest` and then patches it, so versions always match a
  real SDK rather than one hard-coded here.

## Out of scope by decision

Cloud/web session status: there is no supported API to enumerate sessions off this machine,
so `sources/cloud.ts` is a deliberate stub behind `sources.cloud.enabled`. Do not implement
it by scraping claude.ai endpoints. The app is watch-only — replying and approving are what
first-party Remote Control is for.
