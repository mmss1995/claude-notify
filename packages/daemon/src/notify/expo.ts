import type { PushData } from '@ccn/shared';
import type { Notification } from '../core/rules.js';
import type { Device } from '../core/state.js';
import type { SendOutcome, Transport } from './transport.js';

const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo's push service fans out to FCM (and APNs, if an iOS build is ever added)
 * behind one HTTP call, which is the whole reason the app is an Expo app.
 *
 * Only the transition identifiers ride in `data` - Expo caps a message near 4KB,
 * so the app pulls the real session list from GET /status over Tailscale and
 * falls back to its own cache when the mesh is unreachable.
 */
export class ExpoTransport implements Transport {
  readonly id = 'expo';

  constructor(private readonly endpoint: string = ENDPOINT) {}

  async send(notification: Notification, devices: readonly Device[]): Promise<SendOutcome> {
    if (devices.length === 0) {
      return { transport: this.id, ok: true, detail: 'no devices registered' };
    }

    const data: PushData = { kind: notification.kind, sessionId: notification.sessionId };

    const messages = devices.map((device) => ({
      to: device.expoPushToken,
      title: notification.title,
      body: notification.body,
      priority: notification.priority === 'high' ? 'high' : 'default',
      channelId: 'session-status',
      sound: notification.priority === 'high' ? 'default' : null,
      data,
    }));

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      return { transport: this.id, ok: false, detail: `request failed: ${(err as Error).message}` };
    }

    if (!response.ok) {
      return { transport: this.id, ok: false, detail: `HTTP ${response.status}` };
    }

    const invalidTokens: string[] = [];
    try {
      const body = (await response.json()) as { data?: ExpoTicket[] };
      body.data?.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const token = devices[i]?.expoPushToken;
          if (token) invalidTokens.push(token);
        }
      });
    } catch {
      // A malformed ticket body does not mean the push failed; nothing to prune.
    }

    return invalidTokens.length > 0
      ? { transport: this.id, ok: true, invalidTokens }
      : { transport: this.id, ok: true };
  }
}
