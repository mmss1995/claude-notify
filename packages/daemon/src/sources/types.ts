import type { SessionSnapshot, SourceId } from '@ccn/shared';

export interface SourceResult {
  sessions: SessionSnapshot[];
  /** Non-fatal problems worth logging once, e.g. a shape that no longer parses. */
  warnings: string[];
}

/** A surface that can enumerate sessions on its own. */
export interface SessionSource {
  readonly id: SourceId;
  fetch(): Promise<SourceResult>;
}

/**
 * A surface that can only add detail to sessions another source found.
 * Used for the internal per-PID files, which are version-unstable and must
 * never be load-bearing.
 */
export interface SessionEnricher {
  readonly id: SourceId;
  enrich(): Promise<{ patches: Map<string, Partial<SessionSnapshot>>; warnings: string[] }>;
}
