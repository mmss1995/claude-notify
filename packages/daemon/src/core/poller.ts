import type { SessionSnapshot, Transition } from '@ccn/shared';
import type { Config } from '../config.js';
import type { SessionEnricher, SessionSource } from '../sources/types.js';
import type { Transport } from '../notify/transport.js';
import { type DaemonState, saveState } from './state.js';
import { diffSessions } from './diff.js';
import { Debouncer } from './debounce.js';
import { evaluate, type Notification } from './rules.js';
import { log, WarnOnce } from '../logger.js';

export interface TickResult {
  sessions: SessionSnapshot[];
  transitions: Transition[];
  notifications: Notification[];
  skipped: boolean;
  warnings: string[];
}

export interface PollerOptions {
  config: Config;
  sources: SessionSource[];
  enrichers: SessionEnricher[];
  transports: Transport[];
  state: DaemonState;
  /** Compute and report, but never send or persist. */
  dryRun?: boolean;
  /**
   * Injected so tests cannot write to the real state file - the daemon's own
   * state lives in a fixed location, and a test run must not pollute it.
   */
  persist?: (state: DaemonState) => Promise<void>;
}

export class Poller {
  private readonly debouncer: Debouncer;
  private readonly warnOnce = new WarnOnce();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private sessions: SessionSnapshot[];
  private lastPolled: number | null = null;

  constructor(private readonly opts: PollerOptions) {
    this.debouncer = new Debouncer(opts.config.debounceMs);
    this.sessions = opts.state.lastSessions;
  }

  /** Current view, served by GET /status. */
  get currentSessions(): SessionSnapshot[] {
    return this.sessions;
  }

  /** null until a poll has actually succeeded. */
  get lastPolledAt(): number | null {
    return this.lastPolled;
  }

  async tick(now: number = Date.now()): Promise<TickResult> {
    const warnings: string[] = [];
    const merged = new Map<string, SessionSnapshot>();
    let anySourceSucceeded = false;

    const results = await Promise.allSettled(this.opts.sources.map((s) => s.fetch()));

    results.forEach((result, i) => {
      const source = this.opts.sources[i];
      if (result.status === 'rejected') {
        warnings.push(`source ${source?.id}: ${(result.reason as Error).message}`);
        return;
      }
      anySourceSucceeded = true;
      warnings.push(...result.value.warnings.map((w) => `source ${source?.id}: ${w}`));
      for (const session of result.value.sessions) {
        if (!merged.has(session.sessionId)) merged.set(session.sessionId, session);
      }
    });

    // A transient CLI failure must not look like every session vanishing at
    // once, so a tick where nothing could be read is abandoned rather than
    // diffed against an empty set.
    if (!anySourceSucceeded) {
      warnings.forEach((w) => this.warnOnce.warn(w));
      return { sessions: this.sessions, transitions: [], notifications: [], skipped: true, warnings };
    }

    for (const enricher of this.opts.enrichers) {
      try {
        const { patches, warnings: enrichWarnings } = await enricher.enrich();
        warnings.push(...enrichWarnings.map((w) => `enricher ${enricher.id}: ${w}`));
        for (const [sessionId, patch] of patches) {
          const session = merged.get(sessionId);
          if (session) merged.set(sessionId, { ...session, ...patch });
        }
      } catch (err) {
        warnings.push(`enricher ${enricher.id}: ${(err as Error).message}`);
      }
    }

    warnings.forEach((w) => this.warnOnce.warn(w));

    const previous = new Map(this.sessions.map((s) => [s.sessionId, s]));
    const next = [...merged.values()];

    const raw = diffSessions(previous, next, now);
    const settled = this.debouncer.feed(raw, merged, now);

    const notifications: Notification[] = [];
    for (const transition of settled) {
      const notification = evaluate(transition, this.opts.config.rules);
      if (notification) notifications.push(notification);
    }

    this.sessions = next;
    this.lastPolled = now;

    if (!this.opts.dryRun) {
      for (const notification of notifications) await this.dispatch(notification);
      await this.persist(now);
    }

    return { sessions: next, transitions: settled, notifications, skipped: false, warnings };
  }

  private async dispatch(notification: Notification): Promise<void> {
    const devices = this.opts.state.devices;

    // Concurrent on purpose: a transport that is slow or hanging must not hold
    // up the others, and the poll loop is waiting on all of this.
    const outcomes = await Promise.all(
      this.opts.transports.map(async (transport) => {
        try {
          return await transport.send(notification, devices);
        } catch (err) {
          return { transport: transport.id, ok: false, detail: (err as Error).message };
        }
      }),
    );

    for (const outcome of outcomes) {
      if (!outcome.ok) {
        log.error(
          `${outcome.transport}: could not send "${notification.title}" - ${outcome.detail ?? 'unknown error'}`,
        );
        continue;
      }

      if (outcome.invalidTokens?.length) {
        const dead = outcome.invalidTokens;
        this.opts.state.devices = this.opts.state.devices.filter((d) => !dead.includes(d.expoPushToken));
        log.info(`${outcome.transport}: pruned ${dead.length} unregistered device(s)`);
      }

      log.info(`${outcome.transport}: sent "${notification.title}"`);
    }
  }

  private async persist(now: number): Promise<void> {
    const write = this.opts.persist ?? saveState;
    try {
      await write({
        devices: this.opts.state.devices,
        lastSessions: this.sessions,
        updatedAt: now,
        authToken: this.opts.state.authToken,
      });
    } catch (err) {
      this.warnOnce.warn(`could not persist state: ${(err as Error).message}`);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const loop = async (): Promise<void> => {
      try {
        await this.tick();
      } catch (err) {
        log.error(`poll failed: ${(err as Error).message}`);
      }
      if (this.running) this.timer = setTimeout(loop, this.opts.config.pollIntervalMs);
    };

    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
