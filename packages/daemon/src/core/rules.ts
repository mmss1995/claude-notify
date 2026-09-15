import type { Transition, TransitionKind } from '@ccn/shared';
import type { Config } from '../config.js';

export interface Notification {
  kind: TransitionKind;
  sessionId: string;
  title: string;
  body: string;
  priority: 'high' | 'default';
}

const MAX_BODY = 200;

const clamp = (s: string): string => (s.length <= MAX_BODY ? s : `${s.slice(0, MAX_BODY - 1)}…`);

/**
 * Decides whether a settled transition is worth interrupting someone for, and
 * what to say. Returns null when the rule is disabled or the transition is not
 * one we notify on.
 *
 * `started` is off by default: a session going busy is almost always you having
 * just typed something, so the phone buzzing would be pure noise.
 */
export function evaluate(transition: Transition, rules: Config['rules']): Notification | null {
  const { session, kind, sessionId } = transition;
  const where = session.folder;

  switch (kind) {
    case 'needsInput': {
      if (!rules.needsInput) return null;
      const reason = session.waitingFor ? `${session.waitingFor} · ${where}` : `Waiting in ${where}`;
      return {
        kind,
        sessionId,
        title: `${session.name} needs your input`,
        body: clamp(reason),
        priority: 'high',
      };
    }

    case 'finished': {
      if (!rules.finished) return null;
      return {
        kind,
        sessionId,
        title: `${session.name} finished`,
        body: clamp(`All tasks done · ${where}`),
        priority: 'default',
      };
    }

    case 'started': {
      if (!rules.started) return null;
      return {
        kind,
        sessionId,
        title: `${session.name} started working`,
        body: clamp(where),
        priority: 'default',
      };
    }

    case 'disappeared': {
      if (!rules.disappeared) return null;
      return {
        kind,
        sessionId,
        title: `${session.name} ended`,
        body: clamp(`Session closed · ${where}`),
        priority: 'default',
      };
    }

    // A session the daemon simply had not seen before - on startup this would
    // be every session at once, so it never notifies.
    case 'appeared':
      return null;
  }
}
