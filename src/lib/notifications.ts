import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import type { Notification, NotificationContent, NotificationResponse } from 'expo-notifications';
import { AppState, Platform } from 'react-native';

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

/** Background task that receives inline replies on Android when the app is closed. Defined in /index.ts. */
export const NOTIFICATION_TASK = 'huddle-notification-response';
/** Notification category with the Reply text box; the server sends chat pushes with this categoryId. */
const CHAT_CATEGORY = 'chat';
const REPLY_ACTION = 'reply';
const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/** Which chat a notification belongs to. `title` matches older pushes sent before they carried ids. */
export type ChatRef = { spaceId?: string; threadId?: string; title?: string };

const pushAvailable = () => Platform.OS !== 'web' && !inExpoGo();
const loadNotifications = () => import('expo-notifications');

/** The chat ids a push carries in its data (Android may hand them over as a JSON string). */
function chatOf(content: NotificationContent | undefined): ChatRef {
  if (!content) return {};
  let data = (content.data ?? {}) as Record<string, unknown>;
  const raw = (content as unknown as { dataString?: string }).dataString ?? (typeof data.body === 'string' ? data.body : undefined);
  if (!data.space_id && !data.thread_id && raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      // not ours
    }
  }
  return {
    spaceId: typeof data.space_id === 'string' ? data.space_id : undefined,
    threadId: typeof data.thread_id === 'string' ? data.thread_id : undefined,
    title: content.title ?? undefined,
  };
}

function sameChat(n: ChatRef, chat: ChatRef) {
  if (n.spaceId || n.threadId) return (!!chat.spaceId && n.spaceId === chat.spaceId) || (!!chat.threadId && n.threadId === chat.threadId);
  return !!chat.title && n.title === chat.title;
}

let activeChat: ChatRef | null = null;
let appStateHooked = false;

/**
 * Call when a chat screen gains focus (and with null when it loses it). While a chat is
 * open its notifications aren't shown, and any already in the tray are cleared,
 * because you've now read them.
 */
export function setActiveChat(chat: ChatRef | null) {
  activeChat = chat;
  if (chat) clearChatNotifications(chat);
  if (!appStateHooked) {
    appStateHooked = true;
    // Coming back to the app with a chat open counts as reading it too.
    AppState.addEventListener('change', (state) => {
      if (state === 'active' && activeChat) clearChatNotifications(activeChat);
    });
  }
}

/** Removes this chat's notifications from the tray. Best-effort. */
export async function clearChatNotifications(chat: ChatRef) {
  if (!pushAvailable()) return;
  try {
    const Notifications = await loadNotifications();
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n: Notification) => sameChat(chatOf(n.request.content), chat))
        .map((n: Notification) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing to clear, or notifications unavailable.
  }
}

const handled = new Set<string>();

/**
 * Acts on a tap or an inline reply. Runs from the in-app listener, and on Android from the
 * background task when the app was closed, so the same response may arrive twice.
 */
export async function handleNotificationResponse(response: NotificationResponse) {
  const id = response.notification.request.identifier;
  const key = `${id}:${response.actionIdentifier}:${response.userText ?? ''}`;
  if (handled.has(key)) return;
  handled.add(key);
  const chat = chatOf(response.notification.request.content);

  if (response.actionIdentifier === REPLY_ACTION) {
    const text = response.userText?.trim();
    const Notifications = await loadNotifications();
    if (text && (chat.spaceId || chat.threadId)) {
      const ok = await sendReply(chat, text);
      if (!ok) {
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Reply not sent', body: `Open Huddle to try again: "${text.slice(0, 80)}"`, data: { space_id: chat.spaceId, thread_id: chat.threadId } },
          trigger: null,
        });
      }
    }
    // Android keeps a spinner on the notification until it's replaced or removed.
    await Notifications.dismissNotificationAsync(id).catch(() => {});
    await clearChatNotifications(chat);
    return;
  }

  if (response.actionIdentifier === DEFAULT_ACTION) {
    if (chat.spaceId) router.push({ pathname: '/space/[id]', params: { id: chat.spaceId } });
    else if (chat.threadId) router.push({ pathname: '/dm/[id]', params: { id: chat.threadId } });
  }
}

/** Sends an inline reply as the signed-in user, marks the chat read and notifies the others. */
async function sendReply(chat: ChatRef, text: string): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const me = data.session?.user.id;
  if (!me) return false;
  const { data: profile } = await supabase.from('profiles').select('name').eq('id', me).maybeSingle();
  const who = (profile as { name: string } | null)?.name || 'Someone';
  if (chat.spaceId) {
    const { error } = await supabase.rpc('send_message', { p_space: chat.spaceId, p_body: text, p_photo_path: null });
    if (error) return false;
    await supabase.rpc('mark_space_read', { p_space: chat.spaceId });
    const { data: space } = await supabase.from('spaces').select('name').eq('id', chat.spaceId).maybeSingle();
    await notifySpace(chat.spaceId, (space as { name: string } | null)?.name ?? 'Huddle', `${who}: ${text}`);
    return true;
  }
  if (chat.threadId) {
    const { error } = await supabase.rpc('dm_send', { p_thread: chat.threadId, p_body: text });
    if (error) return false;
    await supabase.rpc('dm_mark_read', { p_thread: chat.threadId });
    await notifyDm(chat.threadId, who, text);
    return true;
  }
  return false;
}

let responsesHooked = false;

/** Opens the right chat when a notification is tapped, including the one that launched the app. */
async function listenForResponses() {
  if (responsesHooked) return;
  responsesHooked = true;
  const Notifications = await loadNotifications();
  Notifications.addNotificationResponseReceivedListener((r) => {
    handleNotificationResponse(r);
  });
  const last = await Notifications.getLastNotificationResponseAsync();
  if (last) {
    await Notifications.clearLastNotificationResponseAsync();
    // Give the navigator a moment to mount after a cold start.
    setTimeout(() => handleNotificationResponse(last), 300);
  }
}

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
        handleNotification: async (n) => {
          // Don't ping about a chat you're looking at.
          const here = !!activeChat && sameChat(chatOf(n.request.content), activeChat);
          return { shouldShowBanner: !here, shouldShowList: !here, shouldPlaySound: !here, shouldSetBadge: false };
        },
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

    // Reply straight from the notification. It sends in the background without opening the app.
    await Notifications.setNotificationCategoryAsync(CHAT_CATEGORY, [
      {
        identifier: REPLY_ACTION,
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Reply' },
        options: { opensAppToForeground: false },
      },
    ]);
    await Notifications.registerTaskAsync(NOTIFICATION_TASK).catch(() => {});
    await listenForResponses();

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
