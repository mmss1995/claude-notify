import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionSnapshot } from '@ccn/shared';
import { fetchStatus } from './api';
import { isConfigured, type Settings } from './settings';

const CACHE_KEY = 'ccn.lastStatus.v1';
const POLL_MS = 5000;

interface Cached {
  sessions: SessionSnapshot[];
  generatedAt: number;
}

export interface SessionsState {
  sessions: SessionSnapshot[];
  generatedAt: number | null;
  /** null means the daemon has not completed a poll - not that nothing is running. */
  lastPolledAt: number | null;
  loading: boolean;
  error: string | null;
  /** True when what you are looking at came from cache, not a live read. */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useSessions(settings: Settings | null): SessionsState {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Show something immediately on launch, even off-mesh.
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (!raw || !mounted.current) return;
        const cached = JSON.parse(raw) as Cached;
        setSessions((current) => (current.length === 0 ? cached.sessions : current));
        setGeneratedAt((current) => current ?? cached.generatedAt);
        setStale(true);
      } catch {
        // A missing or corrupt cache is not worth surfacing.
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!settings || !isConfigured(settings)) {
      setLoading(false);
      setError('Set the daemon address and token in Settings.');
      return;
    }

    try {
      const status = await fetchStatus(settings);
      if (!mounted.current) return;
      setSessions(status.sessions);
      setGeneratedAt(status.generatedAt);
      setLastPolledAt(status.lastPolledAt ?? null);
      setError(null);
      setStale(false);
      await AsyncStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ sessions: status.sessions, generatedAt: status.generatedAt } satisfies Cached),
      );
    } catch (err) {
      if (!mounted.current) return;
      // Keep the last known list on screen and mark it stale rather than
      // blanking it - a dropped mesh should not look like "no sessions".
      setError((err as Error).message);
      setStale(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (!settings) return;

    void refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => void refresh(), POLL_MS);

    // Polling a mesh address from a backgrounded app just burns battery; push
    // is what wakes you when the app is not in front of you.
    const onAppStateChange = (state: AppStateStatus): void => {
      if (state === 'active' && timer === null) {
        void refresh();
        timer = setInterval(() => void refresh(), POLL_MS);
      } else if (state !== 'active' && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      if (timer !== null) clearInterval(timer);
      subscription.remove();
    };
  }, [settings, refresh]);

  return { sessions, generatedAt, lastPolledAt, loading, error, stale, refresh };
}
