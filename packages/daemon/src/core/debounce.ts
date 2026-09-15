import type { SessionSnapshot, Transition } from '@ccn/shared';

interface Pending {
  transition: Transition;
  since: number;
}

/**
 * Holds a transition back until its status has actually settled.
 *
 * Claude Code flips between statuses rapidly while running tools; without this,
 * a single task would buzz the phone repeatedly. A newer transition for the same
 * session replaces the pending one, so a status that flaps away before the delay
 * elapses is dropped entirely rather than fired late.
 */
export class Debouncer {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly delayMs: number) {}

  /**
   * Feeds this poll's transitions in and returns those that have now held long
   * enough to be worth a notification.
   */
  feed(
    transitions: readonly Transition[],
    current: ReadonlyMap<string, SessionSnapshot>,
    now: number,
  ): Transition[] {
    for (const transition of transitions) {
      this.pending.set(transition.sessionId, { transition, since: now });
    }

    const released: Transition[] = [];

    for (const [sessionId, entry] of this.pending) {
      if (now - entry.since < this.delayMs) continue;

      this.pending.delete(sessionId);

      const session = current.get(sessionId);
      const stillTrue =
        entry.transition.kind === 'disappeared' ? session === undefined : session?.status === entry.transition.to;

      if (stillTrue) released.push(entry.transition);
    }

    return released;
  }

  /** Exposed for tests and the `once --dry-run` path. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
