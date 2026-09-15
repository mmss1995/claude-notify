import { describe, expect, it } from 'vitest';
import { diffSessions } from '../src/core/diff.js';
import { asMap, session, withStatus } from './helpers.js';

const NOW = 1_700_000_100_000;

describe('diffSessions', () => {
  it('reports a session it has never seen as appeared, not as a status change', () => {
    const fresh = session({ status: 'waiting' });
    const [transition] = diffSessions(new Map(), [fresh], NOW);

    // Matters on startup: every live session is "new" to the daemon, and
    // classifying them as needsInput would buzz the phone for all of them.
    expect(transition?.kind).toBe('appeared');
    expect(transition?.from).toBeNull();
  });

  it('classifies a move into waiting as needsInput', () => {
    const before = session({ status: 'busy' });
    const after = withStatus(before, 'waiting');

    const [transition] = diffSessions(asMap([before]), [after], NOW);

    expect(transition?.kind).toBe('needsInput');
    expect(transition?.from).toBe('busy');
    expect(transition?.to).toBe('waiting');
  });

  it('treats waiting -> idle as finished, not only busy -> idle', () => {
    const before = session({ status: 'waiting' });
    const after = withStatus(before, 'idle');

    const [transition] = diffSessions(asMap([before]), [after], NOW);

    expect(transition?.kind).toBe('finished');
  });

  it('emits nothing when the status is unchanged', () => {
    const s = session({ status: 'busy' });
    expect(diffSessions(asMap([s]), [{ ...s }], NOW)).toEqual([]);
  });

  it('ignores a status value it does not recognise', () => {
    const before = session({ status: 'busy' });
    const after = withStatus(before, 'compacting-something-new');

    // The status enum is open; an unknown value must not be forced into a
    // notification category, but it must not throw either.
    expect(diffSessions(asMap([before]), [after], NOW)).toEqual([]);
  });

  it('reports a session that is gone as disappeared', () => {
    const before = session({ status: 'busy' });
    const [transition] = diffSessions(asMap([before]), [], NOW);

    expect(transition?.kind).toBe('disappeared');
    expect(transition?.to).toBeNull();
  });

  it('tracks several concurrent sessions independently', () => {
    const a = session({ status: 'busy' });
    const b = session({ status: 'busy' });
    const c = session({ status: 'busy' });

    const transitions = diffSessions(asMap([a, b, c]), [a, withStatus(b, 'waiting'), c], NOW);

    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.sessionId).toBe(b.sessionId);
  });
});
