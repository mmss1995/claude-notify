import type { Notification } from '../core/rules.js';
import type { SendOutcome, Transport } from './transport.js';

const TAGS: Record<string, string> = {
  needsInput: 'bell',
  finished: 'white_check_mark',
  started: 'gear',
  disappeared: 'wastebasket',
  appeared: 'eyes',
};

export interface NtfyOptions {
  server: string;
  topic: string;
  token: string | null;
}

/**
 * Covers the iPhone, which has no custom build (that needs the paid Apple
 * developer account). The free ntfy app subscribes to the topic instead.
 *
 * A ntfy.sh topic is readable by anyone who knows its name, so the daemon's
 * `redactPaths` default keeps full client paths out of these messages. Treat
 * this channel as public.
 */
export class NtfyTransport implements Transport {
  readonly id = 'ntfy';

  constructor(private readonly opts: NtfyOptions) {}

  async send(notification: Notification): Promise<SendOutcome> {
    const url = `${this.opts.server.replace(/\/+$/, '')}/${this.opts.topic}`;

    const headers: Record<string, string> = {
      Title: notification.title,
      Priority: notification.priority === 'high' ? '4' : '3',
      Tags: TAGS[notification.kind] ?? 'robot',
    };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: notification.body,
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok
        ? { transport: this.id, ok: true }
        : { transport: this.id, ok: false, detail: `HTTP ${response.status}` };
    } catch (err) {
      return { transport: this.id, ok: false, detail: `request failed: ${(err as Error).message}` };
    }
  }
}
