import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { SessionSnapshot } from '@ccn/shared';
import type { SessionEnricher } from './types.js';

/**
 * `~/.claude/sessions/<pid>.json` is internal Claude Code state, not a public
 * contract - it can change shape or vanish in any release. It is the only place
 * `waitingFor` ("input needed") is exposed, which makes for a much better
 * notification, so we read it opportunistically and treat every failure as a
 * non-event: the daemon stays correct on localCli alone.
 */
const SessionFileSchema = z.object({
  sessionId: z.string(),
  waitingFor: z.string().optional(),
  statusUpdatedAt: z.number().optional(),
});

export interface LocalFilesOptions {
  /** Overridable for tests. */
  dir?: string;
}

export class LocalFilesEnricher implements SessionEnricher {
  readonly id = 'localFiles' as const;

  constructor(private readonly opts: LocalFilesOptions = {}) {}

  private get dir(): string {
    return this.opts.dir ?? join(homedir(), '.claude', 'sessions');
  }

  async enrich(): Promise<{ patches: Map<string, Partial<SessionSnapshot>>; warnings: string[] }> {
    const patches = new Map<string, Partial<SessionSnapshot>>();
    const warnings: string[] = [];

    let entries: string[];
    try {
      entries = (await readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        warnings.push(`could not list ${this.dir}: ${(err as Error).message}`);
      }
      return { patches, warnings };
    }

    let unparsable = 0;
    for (const entry of entries) {
      try {
        const parsed = SessionFileSchema.safeParse(JSON.parse(await readFile(join(this.dir, entry), 'utf8')));
        if (!parsed.success) {
          unparsable += 1;
          continue;
        }
        const { sessionId, waitingFor, statusUpdatedAt } = parsed.data;
        patches.set(sessionId, {
          waitingFor: waitingFor ?? null,
          statusUpdatedAt: statusUpdatedAt ?? null,
        });
      } catch {
        // A session exiting mid-read is routine, not worth a warning each poll.
        unparsable += 1;
      }
    }

    if (unparsable > 0 && patches.size === 0 && entries.length > 0) {
      warnings.push(
        `none of the ${entries.length} files in ${this.dir} matched the expected shape - ` +
          `continuing without "waiting for" detail (this surface is internal and may have changed)`,
      );
    }

    return { patches, warnings };
  }
}
