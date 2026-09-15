import type { SessionSnapshot, SessionStatus } from '@ccn/shared';

let counter = 0;

export function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  counter += 1;
  return {
    sessionId: `session-${counter}`,
    pid: 1000 + counter,
    name: `project-${counter}`,
    folder: 'project',
    cwd: null,
    kind: 'interactive',
    status: 'busy',
    waitingFor: null,
    startedAt: 1_700_000_000_000,
    statusUpdatedAt: null,
    origin: 'localCli',
    ...overrides,
  };
}

export function withStatus(base: SessionSnapshot, status: SessionStatus): SessionSnapshot {
  return { ...base, status };
}

export const asMap = (sessions: readonly SessionSnapshot[]): Map<string, SessionSnapshot> =>
  new Map(sessions.map((s) => [s.sessionId, s]));
