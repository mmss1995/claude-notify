import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const DAEMON_VERSION = '0.1.0';

const CONFIG_DIR = join(homedir(), '.config', 'claude-notification');
const STATE_DIR = join(homedir(), '.local', 'state', 'claude-notification');

export const configPath = (): string => process.env.CLAUDE_NOTIFY_CONFIG ?? join(CONFIG_DIR, 'config.json');
export const statePath = (): string => join(STATE_DIR, 'state.json');
export const logPath = (): string => join(homedir(), 'Library', 'Logs', 'claude-notification.log');

const RulesSchema = z.object({
  needsInput: z.boolean().default(true),
  finished: z.boolean().default(true),
  /** A session vanishing is usually just you quitting the terminal. */
  disappeared: z.boolean().default(false),
  started: z.boolean().default(false),
});

const ConfigSchema = z.object({
  pollIntervalMs: z.number().int().min(1000).default(5000),
  /** A status must hold this long before it notifies, so tool-call churn does not flap. */
  debounceMs: z.number().int().min(0).default(3000),
  /** Send only the folder basename, never the full path. */
  redactPaths: z.boolean().default(true),
  server: z
    .object({
      /** "tailscale" resolves the 100.x address at startup; never binds 0.0.0.0. */
      bind: z.union([z.literal('tailscale'), z.literal('loopback'), z.string().ip()]).default('tailscale'),
      port: z.number().int().min(1).max(65535).default(8787),
      enabled: z.boolean().default(true),
    })
    .default({}),
  rules: RulesSchema.default({}),
  transports: z
    .object({
      expo: z.object({ enabled: z.boolean().default(true) }).default({}),
      /** Banners on this Mac. On by default - it is where the sessions run. */
      macos: z
        .object({
          enabled: z.boolean().default(true),
          /** Bundle id to focus on click, e.g. com.googlecode.iterm2. */
          activateBundleId: z.string().nullable().default(null),
        })
        .default({}),
      ntfy: z
        .object({
          enabled: z.boolean().default(false),
          server: z.string().url().default('https://ntfy.sh'),
          /** Public to anyone who guesses it - use the random default, not a memorable name. */
          topic: z.string().min(8).optional(),
        })
        .default({}),
    })
    .default({}),
  sources: z
    .object({
      localCli: z.boolean().default(true),
      /** Internal per-PID files; enrichment only, never required. */
      localFiles: z.boolean().default(true),
      cloud: z.object({ enabled: z.boolean().default(false) }).default({}),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface Secrets {
  /** Bearer token for the HTTP API. Defence in depth behind Tailscale. */
  authToken: string | null;
  ntfyToken: string | null;
}

export interface LoadedConfig {
  config: Config;
  secrets: Secrets;
  path: string;
}

/**
 * Reads the config file, applying schema defaults for anything absent. A
 * missing file is not an error - the defaults are a working configuration.
 */
export async function loadConfig(): Promise<LoadedConfig> {
  const path = configPath();
  let raw: unknown = {};

  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`Could not read config at ${path}: ${(err as Error).message}`);
    }
  }

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid config at ${path}:\n${issues.join('\n')}`);
  }

  return {
    config: parsed.data,
    secrets: {
      authToken: process.env.CLAUDE_NOTIFY_AUTH_TOKEN ?? null,
      ntfyToken: process.env.CLAUDE_NOTIFY_NTFY_TOKEN ?? null,
    },
    path,
  };
}

/** Writes a starter config with an unguessable ntfy topic. Never overwrites. */
export async function writeDefaultConfig(): Promise<{ path: string; created: boolean }> {
  const path = configPath();
  try {
    await readFile(path, 'utf8');
    return { path, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const defaults = ConfigSchema.parse({});
  defaults.transports.ntfy.topic = `ccn-${randomBytes(12).toString('base64url')}`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(defaults, null, 2)}\n`, { mode: 0o600 });
  return { path, created: true };
}

export async function ensureStateDir(): Promise<string> {
  await mkdir(STATE_DIR, { recursive: true });
  return STATE_DIR;
}
