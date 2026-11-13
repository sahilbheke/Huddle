import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError, supabase } from '@/lib/supabase';

/** Opened from an invite link (huddle://join/<code>): joins, then opens the space. */
export default function JoinFromLinkScreen() {
  const theme = useTheme();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('join_space', { p_code: String(code ?? '') }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) setError(friendlyError(err));
      else router.replace({ pathname: '/space/[id]', params: { id: data as string } });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <Screen title="Joining space">
      {error ? (
        <View style={styles.box}>
          <ErrorText>{error}</ErrorText>
          <Button label="Enter a code instead" kind="secondary" onPress={() => router.replace('/join')} />
        </View>
      ) : (
        <View style={styles.box}>
          <ActivityIndicator color={theme.accent} />
          <ThemedText themeColor="textSecondary">Adding you to the space…</ThemedText>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { gap: Spacing.three, alignItems: 'center', paddingTop: Spacing.five },
});
