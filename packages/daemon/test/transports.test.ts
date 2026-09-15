import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpoTransport } from '../src/notify/expo.js';
import { NtfyTransport } from '../src/notify/ntfy.js';
import { MacosTransport } from '../src/notify/macos.js';
import type { Notification } from '../src/core/rules.js';
import type { Device } from '../src/core/state.js';

const notification: Notification = {
  kind: 'needsInput',
  sessionId: 'abc',
  title: 'eurobet-56 needs your input',
  body: 'input needed · Eurobet - GitlabCodeland',
  priority: 'high',
};

const device = (token: string): Device => ({
  expoPushToken: token,
  platform: 'android',
  registeredAt: 0,
});

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExpoTransport', () => {
  it('sends one message per device with the agreed channel and data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ status: 'ok' }, { status: 'ok' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await new ExpoTransport().send(notification, [device('tok-a'), device('tok-b')]);

    expect(outcome.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      to: 'tok-a',
      title: notification.title,
      priority: 'high',
      // Must match the channel the app creates, or high-priority alerts are silent.
      channelId: 'session-status',
      data: { kind: 'needsInput', sessionId: 'abc' },
    });
  });

  it('does not call the push service when nothing is registered', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await new ExpoTransport().send(notification, []);

    expect(outcome.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports dead tokens so the daemon can prune them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }],
        }),
      ),
    );

    const outcome = await new ExpoTransport().send(notification, [device('alive'), device('dead')]);

    expect(outcome.invalidTokens).toEqual(['dead']);
  });

  it('surfaces a transport failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const outcome = await new ExpoTransport().send(notification, [device('tok')]);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('offline');
  });

  it('treats an unparsable ticket body as a successful send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response),
    );

    const outcome = await new ExpoTransport().send(notification, [device('tok')]);

    expect(outcome.ok).toBe(true);
    expect(outcome.invalidTokens).toBeUndefined();
  });
});

describe('NtfyTransport', () => {
  it('posts to the topic with the title, priority and tag as headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await new NtfyTransport({ server: 'https://ntfy.sh/', topic: 'ccn-secret', token: null }).send(notification);

    const [url, init] = fetchMock.mock.calls[0]!;
    // The trailing slash on the server must not produce a double slash.
    expect(url).toBe('https://ntfy.sh/ccn-secret');
    expect(init.headers).toMatchObject({ Title: notification.title, Priority: '4', Tags: 'bell' });
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBe(notification.body);
  });

  it('uses priority 3 for a normal notification', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await new NtfyTransport({ server: 'https://ntfy.sh', topic: 't', token: null }).send({
      ...notification,
      kind: 'finished',
      priority: 'default',
    });

    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Priority: '3', Tags: 'white_check_mark' });
  });

  it('adds a bearer header for a self-hosted server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await new NtfyTransport({ server: 'https://ntfy.example', topic: 't', token: 'tk_1' }).send(notification);

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tk_1');
  });

  it('reports a non-2xx response as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response));

    const outcome = await new NtfyTransport({ server: 'https://ntfy.sh', topic: 't', token: null }).send(notification);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('403');
  });
});

describe('MacosTransport', () => {
  it('gives each session its own group so banners replace rather than stack', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);

    await new MacosTransport({ notify }).send(notification);

    expect(notify.mock.calls[0]![0]).toMatchObject({
      title: notification.title,
      message: notification.body,
      group: 'claude-notification-abc',
    });
    expect(notify.mock.calls[0]![0]).not.toHaveProperty('wait');
    // Without this, node-notifier's default 10s timeout blocks the poll loop
    // for 10.3s per banner instead of ~0.3s.
    expect(notify.mock.calls[0]![0].timeout).toBe(false);
  });

  it('chimes only when you are actually being asked for something', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const transport = new MacosTransport({ notify });

    await transport.send(notification);
    await transport.send({ ...notification, kind: 'finished', priority: 'default' });

    expect(notify.mock.calls[0]![0].sound).toBe('Ping');
    // `false` rather than undefined: node-notifier forwards own properties, so
    // an undefined value would become the literal string "undefined".
    expect(notify.mock.calls[1]![0].sound).toBe(false);
  });

  it('forwards the bundle id to focus on click when one is configured', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);

    await new MacosTransport({ activateBundleId: 'com.googlecode.iterm2', notify }).send(notification);

    expect(notify.mock.calls[0]![0].activate).toBe('com.googlecode.iterm2');
  });

  it('omits activate entirely when no bundle id is set', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);

    await new MacosTransport({ notify }).send(notification);

    // Must be absent, not undefined - `-activate "undefined"` makes
    // terminal-notifier emit non-JSON that then fails to parse.
    expect(notify.mock.calls[0]![0]).not.toHaveProperty('activate');
  });

  it('reports a failed banner instead of throwing into the poll loop', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('Notification Center refused'));

    const outcome = await new MacosTransport({ notify }).send(notification);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('refused');
  });

  it('keeps separate sessions in separate groups', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const transport = new MacosTransport({ notify });

    await transport.send(notification);
    await transport.send({ ...notification, sessionId: 'xyz' });

    expect(notify.mock.calls[0]![0].group).not.toBe(notify.mock.calls[1]![0].group);
  });
});
