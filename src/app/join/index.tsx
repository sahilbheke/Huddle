import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { codeFrom } from '@/lib/spaces';
import { friendlyError, supabase } from '@/lib/supabase';

export default function JoinScreen() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function join() {
    const code = codeFrom(input);
    if (!code) {
      setError('Paste the invite link or type the 8-character code.');
      return;
    }
    setError('');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('join_space', { p_code: code });
    setBusy(false);
    if (err) setError(friendlyError(err));
    else router.replace({ pathname: '/space/[id]', params: { id: data as string } });
  }

  return (
    <Screen title="Join a space" subtitle="Use the invite a friend sent you">
      <View style={styles.field}>
        <Field
          label="Invite link or code"
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="a1b2c3d4"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={join}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Opening an invite link on your phone does this for you.
        </ThemedText>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Join space" onPress={join} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
});
