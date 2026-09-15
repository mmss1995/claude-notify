import type { Notification } from '../core/rules.js';
import type { Device } from '../core/state.js';

export interface SendOutcome {
  transport: string;
  ok: boolean;
  detail?: string;
  /** Tokens the push service rejected as dead; the daemon prunes these. */
  invalidTokens?: string[];
}

export interface Transport {
  readonly id: string;
  send(notification: Notification, devices: readonly Device[]): Promise<SendOutcome>;
}
