import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { SessionSource, SourceResult } from './types.js';
import { toSnapshot } from './normalize.js';

const exec = promisify(execFile);

/**
 * Shape measured against Claude Code 2.1.270. The published docs also describe
 * `state` and `waitingFor` on this command, but that build does not emit them -
 * `waitingFor` is picked up by the localFiles enricher instead. Unknown keys are
 * ignored rather than rejected so a future release cannot break the daemon.
 */
const AgentSchema = z.object({
  pid: z.number().int(),
  cwd: z.string(),
  kind: z.string(),
  startedAt: z.number(),
  sessionId: z.string(),
  name: z.string(),
  status: z.string(),
});

const AgentsSchema = z.array(z.unknown());

export interface LocalCliOptions {
  redactPaths: boolean;
  /** Overridable so tests can point at a stub binary. */
  command?: string;
  timeoutMs?: number;
}

/** Primary source: the supported `claude agents --json` CLI contract. */
export class LocalCliSource implements SessionSource {
  readonly id = 'localCli' as const;

  constructor(private readonly opts: LocalCliOptions) {}

  async fetch(): Promise<SourceResult> {
    const command = this.opts.command ?? 'claude';
    const warnings: string[] = [];

    let stdout: string;
    try {
      const res = await exec(command, ['agents', '--json'], {
        timeout: this.opts.timeoutMs ?? 10_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      });
      stdout = res.stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      const detail = e.stderr?.trim() || e.message;
      throw new Error(`\`${command} agents --json\` failed: ${detail}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`\`${command} agents --json\` did not return JSON`);
    }

    const list = AgentsSchema.safeParse(parsed);
    if (!list.success) {
      throw new Error(`\`${command} agents --json\` did not return an array`);
    }

    const sessions = [];
    for (const item of list.data) {
      const agent = AgentSchema.safeParse(item);
      if (!agent.success) {
        warnings.push(`skipped an agent entry that no longer matches the expected shape: ${agent.error.issues[0]?.message ?? 'unknown'}`);
        continue;
      }
      sessions.push(toSnapshot(agent.data, this.id, this.opts.redactPaths));
    }

    return { sessions, warnings };
  }
}
