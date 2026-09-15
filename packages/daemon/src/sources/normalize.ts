import { basename } from 'node:path';
import type { SessionSnapshot, SourceId } from '@ccn/shared';

export interface RawSession {
  sessionId: string;
  pid: number;
  name: string;
  cwd: string;
  kind: string;
  status: string;
  startedAt: number;
}

/**
 * Builds the wire-shaped snapshot. `folder` is always the trailing segment so
 * the UI has a label even when `redactPaths` withholds the full path - session
 * cwds carry client names and the ntfy transport is a public channel.
 */
export function toSnapshot(raw: RawSession, origin: SourceId, redactPaths: boolean): SessionSnapshot {
  return {
    sessionId: raw.sessionId,
    pid: raw.pid,
    name: raw.name,
    folder: basename(raw.cwd) || raw.cwd,
    cwd: redactPaths ? null : raw.cwd,
    kind: raw.kind,
    status: raw.status,
    waitingFor: null,
    startedAt: raw.startedAt,
    statusUpdatedAt: null,
    origin,
  };
}
