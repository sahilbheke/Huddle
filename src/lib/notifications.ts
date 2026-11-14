import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Show notifications while the app is foregrounded, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'Daily reminders',
    // eslint-disable-next-line import/namespace -- AndroidImportance is a re-exported enum the import plugin can't trace
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync('activity', {
    name: 'Space activity',
    // eslint-disable-next-line import/namespace -- see above
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** The EAS/Expo project id, needed to mint a push token in a standalone build. */
function projectId() {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Asks for permission and registers this device's push token with the backend.
 * Safe to call on every sign-in; a no-op on web, simulators, and Expo Go (where
 * remote push isn't supported). Returns the token, or null when unavailable.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    await ensureAndroidChannels();
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return token;
  } catch {
    // Expo Go on Android throws here; treat as "no push" rather than crashing.
    return null;
  }
}

/** Tells the backend to notify the other members of a space. Best-effort. */
export async function notifySpace(spaceId: string, title: string, body: string) {
  try {
    await supabase.functions.invoke('notify', { body: { space_id: spaceId, title, body } });
  } catch {
    // A missing or undeployed function must never block posting.
  }
}

/**
 * Sends a test notification to the signed-in user's own devices, straight through
 * Expo's push service. Lets someone confirm notifications work without waiting for
 * the daily job. Returns how many devices were targeted.
 */
export async function sendTestPush(): Promise<number> {
  const { data } = await supabase.rpc('my_push_tokens');
  const tokens = ((data as { token: string }[] | null) ?? []).map((t) => t.token);
  if (tokens.length === 0) return 0;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      tokens.map((to) => ({ to, title: 'Huddle', body: 'Notifications are working 🎉', sound: 'default', channelId: 'reminders' })),
    ),
  });
  return tokens.length;
}
