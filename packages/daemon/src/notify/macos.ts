import notifier from 'node-notifier';
import type { Notification } from '../core/rules.js';
import type { SendOutcome, Transport } from './transport.js';

/**
 * What we hand to node-notifier.
 *
 * `group` and `activate` are genuine terminal-notifier flags, but they are
 * missing from @types/node-notifier. node-notifier forwards every key it is
 * given (`constructArgumentList` is called without an allow-list), so they do
 * reach the binary - the type just does not know about them.
 */
interface MacPayload {
  title: string;
  message: string;
  /** `false` is how node-notifier is told "silent" - it drops the flag entirely. */
  sound: string | false;
  group: string;
  /**
   * Disables node-notifier's default 10s timeout. With it, the helper process
   * lingers and the callback - and therefore the whole poll loop - is blocked
   * for 10.3s per banner. Without it, delivery takes ~0.3s. We never read click
   * callbacks, so there is nothing to wait around for.
   */
  timeout: false;
  /**
   * Present only when configured. It must be absent rather than undefined:
   * node-notifier forwards every own property, so `activate: undefined` becomes
   * the literal `-activate "undefined"`, which terminal-notifier rejects with
   * non-JSON output that then fails to parse.
   */
  activate?: string;
}

export type NotifyFn = (payload: MacPayload) => Promise<void>;

export interface MacosOptions {
  /** Bundle id to focus when the banner is clicked, e.g. com.googlecode.iterm2. */
  activateBundleId?: string | null;
  /** Injected by tests so no test ever posts a real banner. */
  notify?: NotifyFn;
}

const defaultNotify: NotifyFn = (payload) =>
  new Promise((resolve, reject) => {
    notifier.notify(payload as Parameters<typeof notifier.notify>[0], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

/**
 * Desktop banners on the machine the sessions actually run on.
 *
 * Uses node-notifier, which ships the terminal-notifier binary in its vendor
 * directory - so this needs no Homebrew install, and it gets two things plain
 * osascript cannot do: one banner slot per session, and click-to-focus.
 */
export class MacosTransport implements Transport {
  readonly id = 'macos';
  private readonly notify: NotifyFn;

  constructor(private readonly opts: MacosOptions = {}) {
    this.notify = opts.notify ?? defaultNotify;
  }

  async send(notification: Notification): Promise<SendOutcome> {
    const payload: MacPayload = {
      title: notification.title,
      message: notification.body,
      // Sound only when you are actually being asked for something; a "finished"
      // banner arriving while you work nearby should not chime.
      sound: notification.priority === 'high' ? 'Ping' : false,
      // One group per session, so a session's later state replaces its own
      // banner instead of three stacking up for one piece of work.
      group: `claude-notification-${notification.sessionId}`,
      timeout: false,
    };

    if (this.opts.activateBundleId) payload.activate = this.opts.activateBundleId;

    try {
      await this.notify(payload);
      return { transport: this.id, ok: true };
    } catch (err) {
      // A banner that fails to draw must not take down the poll.
      return { transport: this.id, ok: false, detail: (err as Error).message };
    }
  }
}
