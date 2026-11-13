import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing Supabase settings. Copy .env.example to .env and fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // On the web build during static rendering there is no window, so skip storage there.
    storage: Platform.OS === 'web' && typeof window === 'undefined' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the session only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Turns a Postgres error raised by the rules engine into a sentence for the person. */
export function friendlyError(error: { message?: string; hint?: string | null } | null): string {
  if (!error) return '';
  if (error.message === 'hourly_limit' || error.message === 'missing_fields' || error.message === 'chat_off') {
    return error.hint ?? error.message;
  }
  if (error.message === 'invite_not_found') return 'That invite link does not match a space.';
  return error.message ?? 'Something went wrong. Try again.';
}
