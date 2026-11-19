import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// NOTE: expo-notifications / expo-device are imported lazily, inside
// registerForPush, on purpose. Statically importing expo-notifications pulls in
// native modules (e.g. ExpoApplication) that Expo Go doesn't bundle, which throws
// ("Cannot find native module") and crashes the app. We also skip the whole thing
// in Expo Go via executionEnvironment, so that dynamic import never runs there.
// A standalone (EAS) build has the native modules and gets full push support.
// expo-constants is safe to import statically (no native push dependency).

/** True in Expo Go, where the push native modules aren't available. */
function inExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

let handlerSet = false;

/**
 * Asks for permission and registers this device's push token with the backend.
 * Safe to call on every sign-in; a no-op on web, simulators, and Expo Go (where
 * the push native modules aren't available). Returns the token, or null when
 * unavailable. Never throws.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || inExpoGo()) return null;
  try {
    const [Notifications, Device] = await Promise.all([
      import('expo-notifications'),
      import('expo-device'),
    ]);
    if (!Device.isDevice) return null;

    if (!handlerSet) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      handlerSet = true;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Daily reminders',
        importance: Notifications.AndroidImportance.HIGH,
      });
      await Notifications.setNotificationChannelAsync('activity', {
        name: 'Space activity',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return token;
  } catch {
    // Expo Go, simulators and undeployed setups land here; treat as "no push".
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

/** Tells the backend to notify the other person in a direct-message thread. Best-effort. */
export async function notifyDm(threadId: string, title: string, body: string) {
  try {
    await supabase.functions.invoke('notify', { body: { thread_id: threadId, title, body } });
  } catch {
    // A missing or undeployed function must never block sending.
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
