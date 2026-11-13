import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorText, Field } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function ProfileSetupScreen() {
  const { session, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter the name your friends know you by.');
      return;
    }
    setBusy(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    const { error: err } = await supabase
      .from('profiles')
      .update({ name: trimmed, timezone })
      .eq('id', session!.user.id);
    setBusy(false);
    if (err) setError(err.message);
    else await refreshProfile();
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <View style={styles.body}>
          <View style={styles.hero}>
            <ThemedText type="subtitle">What should friends call you?</ThemedText>
            <ThemedText themeColor="textSecondary">This name shows on your check-ins, the board and in chats.</ThemedText>
          </View>
          <View style={styles.form}>
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" autoFocus maxLength={60} returnKeyType="done" onSubmitEditing={save} />
            <ErrorText>{error}</ErrorText>
            <Button label="Continue" onPress={save} busy={busy} />
            <Button label="Sign out" kind="secondary" onPress={signOut} />
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  hero: { gap: Spacing.two },
  form: { gap: Spacing.two },
});
