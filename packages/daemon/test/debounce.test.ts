import { describe, expect, it } from 'vitest';
import { Debouncer } from '../src/core/debounce.js';
import { asMap, session, withStatus } from './helpers.js';
import { diffSessions } from '../src/core/diff.js';

const T0 = 1_700_000_000_000;

describe('Debouncer', () => {
  it('holds a transition back until the status has settled', () => {
    const before = session({ status: 'busy' });
    const after = withStatus(before, 'waiting');
    const debouncer = new Debouncer(3000);

    const transitions = diffSessions(asMap([before]), [after], T0);

    expect(debouncer.feed(transitions, asMap([after]), T0)).toEqual([]);
    expect(debouncer.feed([], asMap([after]), T0 + 2999)).toEqual([]);
    expect(debouncer.feed([], asMap([after]), T0 + 3000)).toHaveLength(1);
  });

  it('drops a transition that flapped away before the delay elapsed', () => {
    const before = session({ status: 'busy' });
    const waiting = withStatus(before, 'waiting');
    const busyAgain = withStatus(before, 'busy');
    const debouncer = new Debouncer(3000);

    debouncer.feed(diffSessions(asMap([before]), [waiting], T0), asMap([waiting]), T0);
    // Claude flips status rapidly while running tools; a blip that has already
    // resolved is not worth interrupting anyone for.
    const released = debouncer.feed([], asMap([busyAgain]), T0 + 5000);

    expect(released).toEqual([]);
  });

  it('lets a newer transition supersede the pending one', () => {
    const before = session({ status: 'busy' });
    const waiting = withStatus(before, 'waiting');
    const idle = withStatus(before, 'idle');
    const debouncer = new Debouncer(1000);

    debouncer.feed(diffSessions(asMap([before]), [waiting], T0), asMap([waiting]), T0);
    debouncer.feed(diffSessions(asMap([waiting]), [idle], T0 + 500), asMap([idle]), T0 + 500);

    const released = debouncer.feed([], asMap([idle]), T0 + 2000);

    expect(released).toHaveLength(1);
    expect(released[0]?.kind).toBe('finished');
  });

  it('releases a disappearance only while the session stays gone', () => {
    const before = session({ status: 'busy' });
    const debouncer = new Debouncer(1000);

    debouncer.feed(diffSessions(asMap([before]), [], T0), new Map(), T0);
    const released = debouncer.feed([], new Map(), T0 + 1500);

    expect(released[0]?.kind).toBe('disappeared');
  });

  it('does not fire for a session that came straight back', () => {
    const before = session({ status: 'busy' });
    const debouncer = new Debouncer(1000);

    debouncer.feed(diffSessions(asMap([before]), [], T0), new Map(), T0);
    const released = debouncer.feed([], asMap([before]), T0 + 1500);

    expect(released).toEqual([]);
  });

  it('keeps sessions separate so one settling does not release another', () => {
    const a = session({ status: 'busy' });
    const b = session({ status: 'busy' });
    const aWaiting = withStatus(a, 'waiting');
    const bWaiting = withStatus(b, 'waiting');
    const debouncer = new Debouncer(1000);

    debouncer.feed(diffSessions(asMap([a, b]), [aWaiting, b], T0), asMap([aWaiting, b]), T0);
    debouncer.feed(diffSessions(asMap([aWaiting, b]), [aWaiting, bWaiting], T0 + 800), asMap([aWaiting, bWaiting]), T0 + 800);

    const released = debouncer.feed([], asMap([aWaiting, bWaiting]), T0 + 1200);

    expect(released).toHaveLength(1);
    expect(released[0]?.sessionId).toBe(a.sessionId);
    expect(debouncer.pendingCount).toBe(1);
  });
});
