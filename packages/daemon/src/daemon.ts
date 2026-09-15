import { loadConfig } from './config.js';
import { loadState, saveState } from './core/state.js';
import { Poller } from './core/poller.js';
import { createStatusServer } from './server/http.js';
import { buildEnrichers, buildSources, buildTransports, resolveAuthToken } from './wire.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  const { config, secrets, path } = await loadConfig();
  const state = await loadState();

  log.info(`claude-notification starting (config: ${path})`);

  const { token, generated } = resolveAuthToken(state, secrets);
  if (generated) {
    await saveState(state);
    log.info('generated a new API token - see `npm run cli -- token` to print it for the app');
  }

  const sources = buildSources(config);
  const transports = buildTransports(config, secrets);

  if (sources.length === 0) {
    log.error('no sources enabled - nothing to watch. Enable sources.localCli in the config.');
    process.exit(1);
  }

  log.info(
    `watching via [${sources.map((s) => s.id).join(', ')}], ` +
      `notifying via [${transports.map((t) => t.id).join(', ') || 'none'}], ` +
      `poll ${config.pollIntervalMs}ms, debounce ${config.debounceMs}ms`,
  );

  const poller = new Poller({
    config,
    sources,
    enrichers: buildEnrichers(config),
    transports,
    state,
  });

  let persisting: Promise<void> | null = null;
  const persist = (): void => {
    // Registration can land mid-poll; serialise writes so they cannot interleave.
    persisting = (persisting ?? Promise.resolve())
      .then(() => saveState({ ...state, lastSessions: poller.currentSessions, updatedAt: Date.now() }))
      .catch((err: Error) => log.error(`could not persist state: ${err.message}`));
  };

  // Poll once before accepting requests: a client that connects the instant the
  // daemon starts would otherwise be told there are no sessions at all.
  try {
    await poller.tick();
  } catch (err) {
    log.warn(`first poll failed: ${(err as Error).message}`);
  }

  if (config.server.enabled) {
    const { server, listen } = createStatusServer({
      poller,
      state,
      authToken: token,
      bind: config.server.bind,
      port: config.server.port,
      onStateChanged: persist,
    });

    try {
      const url = await listen();
      log.info(`status API listening on ${url}`);
    } catch (err) {
      log.error(`could not start the status API: ${(err as Error).message}`);
      log.error('continuing with notifications only - the app will not be able to pull state');
    }

    const shutdown = (signal: string): void => {
      log.info(`${signal} received, shutting down`);
      poller.stop();
      server.close(() => process.exit(0));
      // Do not let an open keep-alive socket hold shutdown open indefinitely.
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  poller.start();
}

main().catch((err: Error) => {
  log.error(err.message);
  process.exit(1);
});
