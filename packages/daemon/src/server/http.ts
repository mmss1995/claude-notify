import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { RegisterResponse, StatusResponse } from '@ccn/shared';
import { DAEMON_VERSION } from '../config.js';
import type { DaemonState } from '../core/state.js';
import { upsertDevice } from '../core/state.js';
import type { Poller } from '../core/poller.js';
import { resolveBindAddress } from './tailscale.js';
import { log } from '../logger.js';

const RegisterSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(['android', 'ios']),
  deviceName: z.string().max(100).optional(),
});

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson(req: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface HttpServerOptions {
  poller: Poller;
  state: DaemonState;
  authToken: string;
  bind: string;
  port: number;
  onStateChanged: () => void;
}

export function createStatusServer(opts: HttpServerOptions): { server: Server; listen: () => Promise<string> } {
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: Error) => {
      log.error(`request failed: ${err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // Unauthenticated on purpose: reveals only that the daemon is alive, which
    // is what you want to curl first when the app cannot connect.
    if (path === '/health') {
      send(res, 200, { ok: true, version: DAEMON_VERSION });
      return;
    }

    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!safeEqual(presented, opts.authToken)) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (path === '/status' && req.method === 'GET') {
      const body: StatusResponse = {
        sessions: opts.poller.currentSessions,
        generatedAt: Date.now(),
        daemonVersion: DAEMON_VERSION,
        lastPolledAt: opts.poller.lastPolledAt,
      };
      send(res, 200, body);
      return;
    }

    if (path === '/register' && req.method === 'POST') {
      let parsed;
      try {
        parsed = RegisterSchema.safeParse(await readJson(req));
      } catch (err) {
        send(res, 400, { error: (err as Error).message });
        return;
      }
      if (!parsed.success) {
        send(res, 400, { error: parsed.error.issues[0]?.message ?? 'invalid body' });
        return;
      }

      opts.state.devices = upsertDevice(opts.state.devices, { ...parsed.data, registeredAt: Date.now() });
      opts.onStateChanged();
      log.info(`registered ${parsed.data.platform} device (${opts.state.devices.length} total)`);

      const body: RegisterResponse = { ok: true, registered: opts.state.devices.length };
      send(res, 200, body);
      return;
    }

    send(res, 404, { error: 'not found' });
  }

  const listen = (): Promise<string> =>
    new Promise((resolve, reject) => {
      let address: string;
      try {
        address = resolveBindAddress(opts.bind).address;
      } catch (err) {
        reject(err as Error);
        return;
      }
      server.once('error', reject);
      server.listen(opts.port, address, () => {
        server.removeListener('error', reject);
        resolve(`http://${address}:${opts.port}`);
      });
    });

  return { server, listen };
}
