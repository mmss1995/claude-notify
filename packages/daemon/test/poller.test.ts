import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '@ccn/shared';
import { Poller } from '../src/core/poller.js';
import type { SessionSource, SourceResult } from '../src/sources/types.js';
import type { SessionEnricher } from '../src/sources/types.js';
import type { Transport, SendOutcome } from '../src/notify/transport.js';
import type { Notification } from '../src/core/rules.js';
import type { Config } from '../src/config.js';
import type { DaemonState } from '../src/core/state.js';
import { session, withStatus } from './helpers.js';

const CONFIG = {
  pollIntervalMs: 5000,
  debounceMs: 0,
  redactPaths: true,
  server: { bind: 'tailscale', port: 8787, enabled: false },
  rules: { needsInput: true, finished: true, disappeared: false, started: false },
  transports: { expo: { enabled: false }, ntfy: { enabled: false, server: 'https://ntfy.sh' } },
  sources: { localCli: true, localFiles: false, cloud: { enabled: false } },
} as unknown as Config;

class StubSource implements SessionSource {
  readonly id = 'localCli' as const;
  constructor(private result: SessionSnapshot[] | Error) {}
  set(result: SessionSnapshot[] | Error): void {
    this.result = result;
  }
  async fetch(): Promise<SourceResult> {
    if (this.result instanceof Error) throw this.result;
    return { sessions: this.result, warnings: [] };
  }
}

class RecordingTransport implements Transport {
  readonly id = 'recording';
  readonly sent: Notification[] = [];
  async send(notification: Notification): Promise<SendOutcome> {
    this.sent.push(notification);
    return { transport: this.id, ok: true };
  }
}

/** Models a transport that throws rather than returning a failed outcome. */
class ExplodingTransport implements Transport {
  readonly id = 'exploding';
  async send(): Promise<SendOutcome> {
    throw new Error('notification center is unavailable');
  }
}

/** Tests must never touch ~/.local/state/claude-notification/state.json. */
const noPersist = async (): Promise<void> => {};

const emptyState = (lastSessions: SessionSnapshot[] = []): DaemonState => ({
  devices: [],
  lastSessions,
  updatedAt: 0,
  authToken: 'test-token',
});

describe('Poller', () => {
  it('abandons the tick when no source could be read', async () => {
    const busy = session({ status: 'busy' });
    const source = new StubSource(new Error('claude: not logged in'));
    const transport = new RecordingTransport();

    const poller = new Poller({
      config: CONFIG,
      sources: [source],
      enrichers: [],
      transports: [transport],
      state: emptyState([busy]),
      dryRun: true,
      persist: noPersist,
    });

    const result = await poller.tick();

    // Without this guard a transient CLI failure reads as every session
    // vanishing, which would both fire bogus alerts and wipe the baseline.
    expect(result.skipped).toBe(true);
    expect(result.transitions).toEqual([]);
    expect(poller.currentSessions).toEqual([busy]);
    expect(transport.sent).toEqual([]);
  });

  it('notifies when a session starts waiting', async () => {
    const busy = session({ status: 'busy' });
    const source = new StubSource([withStatus(busy, 'waiting')]);
    const transport = new RecordingTransport();

    const poller = new Poller({
      config: CONFIG,
      sources: [source],
      enrichers: [],
      transports: [transport],
      state: emptyState([busy]),
      persist: noPersist,
    });

    const result = await poller.tick();

    expect(result.notifications).toHaveLength(1);
    expect(transport.sent[0]?.kind).toBe('needsInput');
    expect(transport.sent[0]?.priority).toBe('high');
  });

  it('applies enricher detail on top of the source', async () => {
    const busy = session({ status: 'busy' });
    const waiting = withStatus(busy, 'waiting');

    const enricher: SessionEnricher = {
      id: 'localFiles',
      async enrich() {
        return { patches: new Map([[busy.sessionId, { waitingFor: 'input needed' }]]), warnings: [] };
      },
    };

    const transport = new RecordingTransport();
    const poller = new Poller({
      config: CONFIG,
      sources: [new StubSource([waiting])],
      enrichers: [enricher],
      transports: [transport],
      state: emptyState([busy]),
      persist: noPersist,
    });

    await poller.tick();

    expect(transport.sent[0]?.body).toContain('input needed');
  });

  it('survives an enricher that throws', async () => {
    const busy = session({ status: 'busy' });
    const enricher: SessionEnricher = {
      id: 'localFiles',
      async enrich() {
        throw new Error('shape changed');
      },
    };

    const poller = new Poller({
      config: CONFIG,
      sources: [new StubSource([withStatus(busy, 'waiting')])],
      enrichers: [enricher],
      transports: [],
      state: emptyState([busy]),
      dryRun: true,
      persist: noPersist,
    });

    const result = await poller.tick();

    expect(result.skipped).toBe(false);
    expect(result.notifications).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('shape changed');
  });

  it('stays quiet on the first tick after a restart', async () => {
    const waiting = session({ status: 'waiting' });
    const transport = new RecordingTransport();

    const poller = new Poller({
      config: CONFIG,
      sources: [new StubSource([waiting])],
      enrichers: [],
      transports: [transport],
      state: emptyState([]),
      persist: noPersist,
    });

    await poller.tick();

    expect(transport.sent).toEqual([]);
  });
});

describe('Poller dispatch', () => {
  it('still delivers through healthy transports when one throws', async () => {
    const busy = session({ status: 'busy' });
    const healthy = new RecordingTransport();

    const poller = new Poller({
      config: CONFIG,
      sources: [new StubSource([withStatus(busy, 'waiting')])],
      enrichers: [],
      // Order matters: the throwing one goes first, so a serial implementation
      // that did not catch would never reach the second.
      transports: [new ExplodingTransport(), healthy],
      state: emptyState([busy]),
      persist: noPersist,
    });

    await poller.tick();

    expect(healthy.sent).toHaveLength(1);
    expect(healthy.sent[0]?.kind).toBe('needsInput');
  });
});
