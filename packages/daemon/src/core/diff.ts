import type { SessionSnapshot, Transition } from '@ccn/shared';

/**
 * Classifies a status change.
 *
 * `finished` deliberately covers any move into `idle`, not just `busy -> idle`:
 * a session can settle from `waiting` once you answer the last prompt, and that
 * is still "all tasks done" from the phone's point of view.
 *
 * An unrecognised status produces no transition. The status enum is open, so a
 * value a future release invents must pass through quietly rather than fire a
 * notification nobody can interpret.
 */
function classify(from: string, to: string): Transition['kind'] | null {
  if (from === to) return null;
  if (to === 'waiting') return 'needsInput';
  if (to === 'idle') return 'finished';
  if (to === 'busy') return 'started';
  return null;
}

/** Pure: compares two polls and reports what changed. */
export function diffSessions(
  prev: ReadonlyMap<string, SessionSnapshot>,
  next: readonly SessionSnapshot[],
  now: number,
): Transition[] {
  const transitions: Transition[] = [];
  const seen = new Set<string>();

  for (const session of next) {
    seen.add(session.sessionId);
    const before = prev.get(session.sessionId);

    if (!before) {
      transitions.push({
        kind: 'appeared',
        sessionId: session.sessionId,
        from: null,
        to: session.status,
        session,
        at: now,
      });
      continue;
    }

    const kind = classify(before.status, session.status);
    if (kind) {
      transitions.push({
        kind,
        sessionId: session.sessionId,
        from: before.status,
        to: session.status,
        session,
        at: now,
      });
    }
  }

  for (const [sessionId, session] of prev) {
    if (seen.has(sessionId)) continue;
    transitions.push({
      kind: 'disappeared',
      sessionId,
      from: session.status,
      to: null,
      session,
      at: now,
    });
  }

  return transitions;
}
