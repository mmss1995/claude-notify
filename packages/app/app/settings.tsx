import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EMPTY_SETTINGS, isConfigured, loadSettings, saveSettings, type Settings } from '../src/settings';
import { registerForPush } from '../src/notifications';
import { colors } from '../src/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setReady(true);
    });
  }, []);

  const save = async (): Promise<void> => {
    await saveSettings(settings);
    router.back();
  };

  /** Saves first, then proves the whole path end to end: reachability, token, push. */
  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setResult(null);
    await saveSettings(settings);

    const registration = await registerForPush(settings);
    setResult(
      registration.ok
        ? { ok: true, message: 'Connected and registered for push.' }
        : { ok: false, message: registration.reason },
    );
    setTesting(false);
  };

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Daemon address</Text>
      <TextInput
        style={styles.input}
        value={settings.daemonUrl}
        onChangeText={(daemonUrl) => setSettings((s) => ({ ...s, daemonUrl }))}
        placeholder="http://your-mac:8787"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputMode="url"
      />
      <Text style={styles.hint}>
        Your Mac's Tailscale MagicDNS name, or its 100.x address. Both devices must be on the same tailnet.
      </Text>

      <Text style={styles.label}>API token</Text>
      <TextInput
        style={styles.input}
        value={settings.authToken}
        onChangeText={(authToken) => setSettings((s) => ({ ...s, authToken }))}
        placeholder="paste the token"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Text style={styles.hint}>Print it on the Mac with: npm run cli -- token</Text>

      <Pressable
        style={[styles.button, (!isConfigured(settings) || testing) && styles.buttonDisabled]}
        disabled={!isConfigured(settings) || testing}
        onPress={() => void testConnection()}
      >
        <Text style={styles.buttonText}>{testing ? 'Testing…' : 'Test connection'}</Text>
      </Pressable>

      {result ? (
        <View style={[styles.result, result.ok ? styles.resultOk : styles.resultBad]}>
          <Text style={styles.resultText}>{result.message}</Text>
        </View>
      ) : null}

      <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => void save()}>
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  label: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 12 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  button: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  result: { borderRadius: 8, padding: 12, borderWidth: 1, marginTop: 12 },
  resultOk: { borderColor: '#3fb950', backgroundColor: '#12251a' },
  resultBad: { borderColor: colors.danger, backgroundColor: '#2a1416' },
  resultText: { color: colors.text, fontSize: 13 },
});
