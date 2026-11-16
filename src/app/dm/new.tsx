import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { colorForUser } from '@/lib/activity';
import { type DmContact } from '@/lib/dm';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError, supabase } from '@/lib/supabase';

export default function NewChatScreen() {
  const theme = useTheme();
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('dm_contacts');
    setContacts((data as DmContact[] | null) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function openChat(other: DmContact) {
    if (busy) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('dm_open', { p_other: other.user_id });
    setBusy(false);
    if (err || !data) {
      setError(friendlyError(err));
      return;
    }
    router.replace({ pathname: '/dm/[id]', params: { id: data as string, name: other.name } });
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
            hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText type="subtitle">New chat</ThemedText>
        </View>
        <ErrorText>{error}</ErrorText>
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.user_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Message ${item.name}`}
              disabled={busy}
              onPress={() => openChat(item)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed || busy ? 0.6 : 1 },
              ]}>
              <View style={[styles.avatar, { backgroundColor: colorForUser(item.user_id) }]}>
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {item.name.slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{item.name}</ThemedText>
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? undefined : (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="smallBold">Nobody to message yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Join or create a space with friends first. Everyone in your spaces shows up here.
                </ThemedText>
              </ThemedView>
            )
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 14, borderWidth: 1, padding: Spacing.three },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  empty: { borderRadius: 14, padding: Spacing.four, gap: Spacing.one, margin: Spacing.three },
});
