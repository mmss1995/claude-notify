import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerDevice } from './api';
import type { Settings } from './settings';

/** Foreground pushes should still surface - the list alone is easy to miss. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Must match `channelId` in the daemon's Expo transport, or high-priority
  // alerts arrive silently.
  await Notifications.setNotificationChannelAsync('session-status', {
    name: 'Session status',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export type RegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

/**
 * Asks for permission, gets the Expo push token, and hands it to the daemon so
 * it knows where to push. Runs on every launch: tokens rotate, and the daemon
 * de-duplicates by token.
 */
export async function registerForPush(settings: Settings): Promise<RegistrationResult> {
  if (!Device.isDevice) {
    return { ok: false, reason: 'Push notifications need a physical device, not an emulator.' };
  }

  await configureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    return { ok: false, reason: 'Notification permission was denied.' };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { ok: false, reason: 'No EAS project id found. Run `eas init` in packages/app.' };
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    return { ok: false, reason: `Could not get a push token: ${(err as Error).message}` };
  }

  try {
    await registerDevice(settings, {
      expoPushToken: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceName: Device.deviceName ?? undefined,
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  return { ok: true, token };
}
