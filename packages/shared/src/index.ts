/**
 * Wire contract shared by the daemon and the React Native app.
 *
 * Both sides import these types, so the HTTP payloads cannot drift apart.
 * Keep this module dependency-free - the app bundles it through Metro.
 */

/**
 * Statuses observed from `claude agents --json` on 2.1.270 are `busy` and
 * `waiting`; the docs also mention `idle`. The union stays open on purpose:
 * a future Claude Code release may add values, and an unknown status must
 * flow through the daemon rather than crash it.
 */
export type KnownSessionStatus = 'busy' | 'waiting' | 'idle';
export type SessionStatus = KnownSessionStatus | (string & {});

export const KNOWN_STATUSES: readonly KnownSessionStatus[] = ['busy', 'waiting', 'idle'];

export function isKnownStatus(status: SessionStatus): status is KnownSessionStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(status);
}

/** Which state surface a snapshot came from. */
export type SourceId = 'localCli' | 'localFiles' | 'cloud';

/**
 * One Claude Code session, normalised across sources.
 *
 * `cwd` is null when the daemon runs with `redactPaths` enabled; `folder` is
 * the trailing path segment and is always populated, so the UI has something
 * to show without leaking a full client path.
 */
export interface SessionSnapshot {
  sessionId: string;
  pid: number;
  name: string;
  folder: string;
  cwd: string | null;
  kind: string;
  status: SessionStatus;
  /** Only available via the internal per-PID files, e.g. "input needed". */
  waitingFor: string | null;
  startedAt: number;
  statusUpdatedAt: number | null;
  origin: SourceId;
}

export type TransitionKind =
  | 'appeared'
  | 'started'
  | 'needsInput'
  | 'finished'
  | 'disappeared';

export interface Transition {
  kind: TransitionKind;
  sessionId: string;
  /** null when the session had not been seen before. */
  from: SessionStatus | null;
  /** null when the session vanished. */
  to: SessionStatus | null;
  session: SessionSnapshot;
  at: number;
}

/** GET /status */
export interface StatusResponse {
  sessions: SessionSnapshot[];
  generatedAt: number;
  daemonVersion: string;
  /**
   * When the daemon last completed a poll, or null if it has not managed one
   * yet. An empty `sessions` with a null here means "don't know", not "nothing
   * running" - the app must not claim the latter on the strength of the former.
   */
  lastPolledAt: number | null;
}

/** POST /register */
export interface RegisterRequest {
  expoPushToken: string;
  platform: 'android' | 'ios';
  /** Optional human label so several devices are distinguishable in logs. */
  deviceName?: string;
}

export interface RegisterResponse {
  ok: true;
  registered: number;
}

/**
 * Data ferried inside a push. Deliberately small - Expo caps a message at
 * 4KB, so the session list is NOT shipped here. The app deep-links on
 * `sessionId` and pulls the current truth from GET /status over Tailscale,
 * falling back to its own cached copy when the mesh is unreachable.
 */
export interface PushData {
  kind: TransitionKind;
  sessionId: string;
}

export interface ErrorResponse {
  error: string;
}
