import { loadConfig, writeDefaultConfig, configPath, statePath, DAEMON_VERSION } from './config.js';
import { loadState, saveState } from './core/state.js';
import { Poller } from './core/poller.js';
import type { Notification } from './core/rules.js';
import { buildEnrichers, buildSources, buildTransports, resolveAuthToken } from './wire.js';
import { findTailscaleAddress } from './server/tailscale.js';

const USAGE = `claude-notification ${DAEMON_VERSION}

  init          Write a starter config with a random ntfy topic (never overwrites)
  token         Print the bearer token the phone app needs
  status        Show every session the daemon can currently see
  once          Run one poll and report what it would notify about
    --dry-run   (default) send nothing
    --send      actually deliver the notifications
  test-notify   Send one synthetic notification down every enabled transport
`;

const out = (s = ''): void => {
  process.stdout.write(`${s}\n`);
};

function age(from: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

async function cmdInit(): Promise<void> {
  const { path, created } = await writeDefaultConfig();
  out(created ? `Wrote a starter config to ${path}` : `Config already exists at ${path} - left untouched`);

  const { config } = await loadConfig();
  const topic = config.transports.ntfy.topic;
  if (topic) {
    out('');
    out(`ntfy topic: ${topic}`);
    out('Subscribe to it in the ntfy app. Anyone who knows this string can read the alerts,');
    out('so keep it out of screenshots and chats.');
  }
}

async function cmdToken(): Promise<void> {
  const { secrets } = await loadConfig();
  const state = await loadState();
  const { token, generated } = resolveAuthToken(state, secrets);
  if (generated) await saveState(state);

  const address = findTailscaleAddress();
  const { config } = await loadConfig();

  out(token);
  out('');
  out(address ? `Daemon URL: http://${address}:${config.server.port}` : 'Tailscale address not found - is Tailscale running?');
  out(`State file: ${statePath()} (mode 600)`);
}

async function cmdStatus(): Promise<void> {
  const { config } = await loadConfig();
  const poller = new Poller({
    config,
    sources: buildSources(config),
    enrichers: buildEnrichers(config),
    transports: [],
    state: await loadState(),
    dryRun: true,
  });

  const result = await poller.tick();

  if (result.skipped) {
    out('Could not read any source this tick:');
    result.warnings.forEach((w) => out(`  ${w}`));
    process.exitCode = 1;
    return;
  }

  if (result.sessions.length === 0) {
    out('No Claude Code sessions are running.');
    return;
  }

  out(`${result.sessions.length} session(s):`);
  out('');
  for (const s of result.sessions) {
    const detail = s.waitingFor ? ` (${s.waitingFor})` : '';
    out(`  ${s.status.padEnd(8)} ${s.name}`);
    out(`  ${''.padEnd(8)} ${s.folder}${detail} · up ${age(s.startedAt)} · pid ${s.pid}`);
    out('');
  }

  result.warnings.forEach((w) => out(`warning: ${w}`));
}

async function cmdOnce(send: boolean): Promise<void> {
  const { config, secrets } = await loadConfig();
  // Debounce exists to stop a running session buzzing the phone on every tool
  // call; for a one-shot inspection it would just hide everything.
  const immediate = { ...config, debounceMs: 0 };

  const poller = new Poller({
    config: immediate,
    sources: buildSources(config),
    enrichers: buildEnrichers(config),
    transports: send ? buildTransports(config, secrets) : [],
    state: await loadState(),
    dryRun: !send,
  });

  const result = await poller.tick();

  if (result.skipped) {
    out('Could not read any source this tick:');
    result.warnings.forEach((w) => out(`  ${w}`));
    process.exitCode = 1;
    return;
  }

  out(`${result.sessions.length} session(s) seen, ${result.transitions.length} transition(s) since the last saved state.`);
  out('');

  for (const t of result.transitions) {
    out(`  ${t.from ?? '-'} -> ${t.to ?? '-'}  [${t.kind}]  ${t.session.name}`);
  }

  if (result.notifications.length === 0) {
    out(send ? 'Nothing to send.' : 'Nothing would be sent.');
  } else {
    out('');
    out(send ? 'Sent:' : 'Would send:');
    for (const n of result.notifications) {
      out(`  [${n.priority}] ${n.title}`);
      out(`           ${n.body}`);
    }
  }

  result.warnings.forEach((w) => out(`warning: ${w}`));
}

async function cmdTestNotify(): Promise<void> {
  const { config, secrets } = await loadConfig();
  const state = await loadState();
  const transports = buildTransports(config, secrets);

  if (transports.length === 0) {
    out('No transports are enabled - check transports.* in the config.');
    process.exitCode = 1;
    return;
  }

  const notification: Notification = {
    kind: 'needsInput',
    sessionId: 'test',
    title: 'claude-notification test',
    body: 'If you can read this on your phone, the transport works.',
    priority: 'high',
  };

  for (const transport of transports) {
    const outcome = await transport.send(notification, state.devices);
    const detail = outcome.detail ? ` - ${outcome.detail}` : '';
    out(`${outcome.ok ? 'ok  ' : 'FAIL'} ${transport.id}${detail}`);
    if (!outcome.ok) process.exitCode = 1;
  }

  if (state.devices.length === 0) {
    out('');
    out('No devices are registered, so the Expo push had nowhere to go.');
    out('Open the app once while it can reach the daemon - it registers itself.');
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'init':
      return cmdInit();
    case 'token':
      return cmdToken();
    case 'status':
      return cmdStatus();
    case 'once':
      return cmdOnce(rest.includes('--send'));
    case 'test-notify':
      return cmdTestNotify();
    case 'config':
      out(configPath());
      return;
    default:
      out(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
