import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ccn.settings.v1';

export interface Settings {
  /** e.g. http://matteos-mac:8787 - the MagicDNS name beats a raw 100.x IP. */
  daemonUrl: string;
  authToken: string;
}

export const EMPTY_SETTINGS: Settings = { daemonUrl: '', authToken: '' };

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      daemonUrl: typeof parsed.daemonUrl === 'string' ? parsed.daemonUrl : '',
      authToken: typeof parsed.authToken === 'string' ? parsed.authToken : '',
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

export const isConfigured = (s: Settings): boolean => s.daemonUrl.trim() !== '' && s.authToken.trim() !== '';
