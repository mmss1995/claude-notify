import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/rules.js';
import type { Transition } from '@ccn/shared';
import { session } from './helpers.js';

const RULES = { needsInput: true, finished: true, disappeared: false, started: false };

const transition = (kind: Transition['kind'], overrides = {}): Transition => {
  const s = session({ name: 'eurobet-56', folder: 'Eurobet - GitlabCodeland', ...overrides });
  return { kind, sessionId: s.sessionId, from: 'busy', to: 'waiting', session: s, at: Date.now() };
};

describe('evaluate', () => {
  it('uses waitingFor in the body when the enricher supplied it', () => {
    const notification = evaluate(transition('needsInput', { waitingFor: 'input needed' }), RULES);

    expect(notification?.priority).toBe('high');
    expect(notification?.title).toContain('eurobet-56');
    expect(notification?.body).toContain('input needed');
  });

  it('still produces a usable message without waitingFor', () => {
    // The enricher reads internal files that may vanish in any release, so the
    // needsInput path has to read well on localCli data alone.
    const notification = evaluate(transition('needsInput', { waitingFor: null }), RULES);

    expect(notification?.body).toBe('Waiting in Eurobet - GitlabCodeland');
  });

  it('names the session so concurrent ones are distinguishable', () => {
    const notification = evaluate(transition('finished'), RULES);

    expect(notification?.title).toContain('eurobet-56');
    expect(notification?.priority).toBe('default');
  });

  it('never notifies for appeared, so a restart stays silent', () => {
    expect(evaluate(transition('appeared'), RULES)).toBeNull();
  });

  it('respects a disabled rule', () => {
    expect(evaluate(transition('needsInput'), { ...RULES, needsInput: false })).toBeNull();
    expect(evaluate(transition('disappeared'), RULES)).toBeNull();
    expect(evaluate(transition('started'), RULES)).toBeNull();
  });

  it('honours started once it is switched on', () => {
    expect(evaluate(transition('started'), { ...RULES, started: true })?.kind).toBe('started');
  });

  it('clamps a long body so mobile OSes do not truncate mid-word', () => {
    const notification = evaluate(transition('needsInput', { waitingFor: 'x'.repeat(400) }), RULES);

    expect(notification!.body.length).toBeLessThanOrEqual(200);
  });
});
