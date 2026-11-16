import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { colorForUser } from '@/lib/activity';
import { type DmSummary, whenShort } from '@/lib/dm';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function ChatsScreen() {
  const theme = useTheme();
  const [rows, setRows] = useState<DmSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('dm_list');
    setRows((data as DmSummary[] | null) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Live: any new direct message reorders and re-counts the list.
  useEffect(() => {
    const channel = supabase
      .channel('dm:list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Chats</ThemedText>
          <Button label="New chat" onPress={() => router.push('/dm/new')} />
        </View>
        <FlatList
          data={rows}
          keyExtractor={(r) => r.thread_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.accent} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${item.other_name}${item.unread ? `, ${item.unread} unread` : ''}`}
              onPress={() => router.push({ pathname: '/dm/[id]', params: { id: item.thread_id, name: item.other_name } })}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
              ]}>
              <View style={[styles.avatar, { backgroundColor: colorForUser(item.other_id) }]}>
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {item.other_name.slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <View style={styles.grow}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.other_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {item.last_body ?? 'Say hello'}
                </ThemedText>
              </View>
              <View style={styles.meta}>
                <ThemedText type="small" themeColor="textSecondary">
                  {whenShort(item.last_at)}
                </ThemedText>
                {item.unread > 0 ? (
                  <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <ThemedText type="small" style={{ color: theme.accentText }}>
                      {item.unread}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            loading ? undefined : (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="smallBold">No chats yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Tap “New chat” to message someone from your spaces.
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
  grow: { flex: 1, minWidth: 0 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  list: {
    padding: Spacing.three,
    paddingBottom: BottomTabInset,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 14, borderWidth: 1, padding: Spacing.three },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  meta: { alignItems: 'flex-end', gap: Spacing.half },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  empty: { borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
});
