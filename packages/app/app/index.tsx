import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import type { SessionSnapshot } from '@ccn/shared';
import { useSessions } from '../src/useSessions';
import { loadSettings, isConfigured, type Settings } from '../src/settings';
import { registerForPush } from '../src/notifications';
import { age, colors, statusColor, statusLabel } from '../src/theme';

function StatusPill({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{statusLabel(status)}</Text>
    </View>
  );
}

function SessionRow({ session }: { session: SessionSnapshot }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.name} numberOfLines={1}>
          {session.name}
        </Text>
        <StatusPill status={session.status} />
      </View>

      <Text style={styles.folder} numberOfLines={1}>
        {session.folder}
      </Text>

      {session.waitingFor ? <Text style={styles.waitingFor}>{session.waitingFor}</Text> : null}

      <Text style={styles.meta}>
        up {age(session.startedAt)} · pid {session.pid} · {session.kind}
      </Text>
    </View>
  );
}

export default function SessionsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const { sessions, generatedAt, lastPolledAt, loading, error, stale, refresh } = useSessions(settings);

  // Settings can change in the modal, so re-read them whenever this screen
  // comes back into focus rather than only on mount.
  useFocusEffect(
    useCallback(() => {
      void loadSettings().then(setSettings);
    }, []),
  );

  useEffect(() => {
    if (!settings || !isConfigured(settings)) return;
    void registerForPush(settings).then((result) => {
      setPushNote(result.ok ? null : result.reason);
    });
  }, [settings]);

  if (loading && sessions.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const waiting = sessions.filter((s) => s.status === 'waiting').length;

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.sessionId}
        renderItem={({ item }) => <SessionRow session={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.summaryRow}>
              <Text style={styles.summary}>
                {sessions.length} session{sessions.length === 1 ? '' : 's'}
                {waiting > 0 ? ` · ${waiting} needing you` : ''}
              </Text>
              <Link href="/settings" asChild>
                <Pressable hitSlop={12}>
                  <Text style={styles.link}>Settings</Text>
                </Pressable>
              </Link>
            </View>

            {error ? (
              <View style={[styles.banner, styles.bannerError]}>
                <Text style={styles.bannerText}>{error}</Text>
              </View>
            ) : null}

            {stale && !error ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  Showing cached data{generatedAt ? ` from ${age(generatedAt)} ago` : ''}.
                </Text>
              </View>
            ) : null}

            {pushNote ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Push not active: {pushNote}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.empty}>
              {lastPolledAt === null
                ? 'The daemon has not completed a poll yet.'
                : 'No Claude Code sessions are running.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  list: { padding: 16, gap: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  summary: { color: colors.textDim, fontSize: 13 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  folder: { color: colors.textDim, fontSize: 13 },
  waitingFor: { color: colors.warn, fontSize: 13, fontWeight: '500' },
  meta: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  banner: {
    backgroundColor: colors.cardAlt,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerError: { borderColor: colors.danger },
  bannerText: { color: colors.textDim, fontSize: 12 },
  empty: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
});
