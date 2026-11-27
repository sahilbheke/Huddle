import * as TaskManager from 'expo-task-manager';
import type { NotificationResponse } from 'expo-notifications';
import { Platform } from 'react-native';

import { handleNotificationResponse, NOTIFICATION_TASK } from '@/lib/notifications';

// Android runs this for a notification action (such as Reply) while the app is in the
// background or closed. Everything else arrives through the in-app listener.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }) => {
    if (error || !data || typeof data !== 'object' || !('actionIdentifier' in data)) return;
    await handleNotificationResponse(data as NotificationResponse);
  });
}
