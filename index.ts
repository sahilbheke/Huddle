// App entry. The notification task has to be defined before anything else runs, so that
// Android can deliver an inline reply to it even when the app was closed.
import './src/lib/notification-task';
import 'expo-router/entry';
