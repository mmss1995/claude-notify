import type { SessionSource, SourceResult } from './types.js';

/**
 * Placeholder for cloud / web sessions.
 *
 * Deliberately not implemented: as of Claude Code 2.1.270 there is no supported
 * API to enumerate sessions that are not on this machine. `claude agents --json`
 * is local-only, and cloud sessions are listable solely through the claude.ai
 * web UI. Reaching them today would mean scraping undocumented endpoints, which
 * would break without warning.
 *
 * When such an API ships, implement fetch() here and flip
 * `sources.cloud.enabled` in the config - nothing else needs to change, because
 * the poller merges every SessionSource identically.
 */
export class CloudSource implements SessionSource {
  readonly id = 'cloud' as const;

  async fetch(): Promise<SourceResult> {
    return {
      sessions: [],
      warnings: ['cloud source is enabled in config but not implemented - no supported API exists yet'],
    };
  }
}
