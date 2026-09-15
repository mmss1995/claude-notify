import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { SessionSnapshot } from '@ccn/shared';
import { ensureStateDir, statePath } from '../config.js';

const DeviceSchema = z.object({
  expoPushToken: z.string(),
  platform: z.enum(['android', 'ios']),
  deviceName: z.string().optional(),
  registeredAt: z.number(),
});

export type Device = z.infer<typeof DeviceSchema>;

const StateSchema = z.object({
  devices: z.array(DeviceSchema).default([]),
  lastSessions: z.array(z.unknown()).default([]),
  updatedAt: z.number().default(0),
  /** Generated on first run when no token is supplied via the environment. */
  authToken: z.string().optional(),
});

export interface DaemonState {
  devices: Device[];
  lastSessions: SessionSnapshot[];
  updatedAt: number;
  authToken: string | null;
}

const EMPTY: DaemonState = { devices: [], lastSessions: [], updatedAt: 0, authToken: null };

export async function loadState(): Promise<DaemonState> {
  try {
    const parsed = StateSchema.safeParse(JSON.parse(await readFile(statePath(), 'utf8')));
    if (!parsed.success) return { ...EMPTY };
    return {
      devices: parsed.data.devices,
      lastSessions: parsed.data.lastSessions as SessionSnapshot[],
      updatedAt: parsed.data.updatedAt,
      authToken: parsed.data.authToken ?? null,
    };
  } catch {
    // Missing or corrupt state is not fatal - the daemon rebuilds it on the
    // next poll. Only the registered push tokens are actually worth keeping.
    return { ...EMPTY };
  }
}

/** Atomic: writes a sibling temp file then renames, so a crash cannot truncate state. */
export async function saveState(state: DaemonState): Promise<void> {
  const dir = await ensureStateDir();
  const target = statePath();
  const tmp = join(dir, `.state.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, target);
}

/** Registers a device, replacing any existing entry with the same token. */
export function upsertDevice(devices: Device[], device: Device): Device[] {
  const rest = devices.filter((d) => d.expoPushToken !== device.expoPushToken);
  return [...rest, device];
}
