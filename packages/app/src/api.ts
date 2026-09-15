import type { RegisterRequest, RegisterResponse, StatusResponse } from '@ccn/shared';
import type { Settings } from './settings';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const trim = (url: string): string => url.trim().replace(/\/+$/, '');

async function request<T>(settings: Settings, path: string, init: RequestInit = {}): Promise<T> {
  const url = `${trim(settings.daemonUrl)}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${settings.authToken.trim()}`,
        accept: 'application/json',
      },
      // The daemon is on the mesh; if Tailscale is down this should fail fast
      // rather than leave the list spinning.
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new ApiError(
      `Cannot reach ${trim(settings.daemonUrl)}. Is Tailscale connected and the daemon running?`,
    );
  }

  if (response.status === 401) {
    throw new ApiError('The daemon rejected this token. Re-copy it from `npm run cli -- token`.', 401);
  }
  if (!response.ok) {
    throw new ApiError(`Daemon returned HTTP ${response.status}`, response.status);
  }

  return (await response.json()) as T;
}

export const fetchStatus = (settings: Settings): Promise<StatusResponse> =>
  request<StatusResponse>(settings, '/status');

export const registerDevice = (settings: Settings, body: RegisterRequest): Promise<RegisterResponse> =>
  request<RegisterResponse>(settings, '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
