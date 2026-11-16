import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { colorForUser } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { roleLabel, TEMPLATES, type Role, type Template } from '@/lib/spaces';
import { supabase } from '@/lib/supabase';

type SpaceRow = { role: Role; spaces: { id: string; name: string; template: Template } | null };

export default function SpacesScreen() {
  const theme = useTheme();
  const { profile, session, signOut } = useAuth();
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, unread] = await Promise.all([
      supabase
        .from('space_members')
        .select('role, spaces(id, name, template)')
        .eq('user_id', session!.user.id)
        .order('joined_at', { ascending: false }),
      supabase.rpc('space_unreads'),
    ]);
    setRows((list.data as SpaceRow[] | null) ?? []);
    const counts: Record<string, number> = {};
    for (const u of (unread.data as { space_id: string; unread: number }[] | null) ?? []) counts[u.space_id] = u.unread;
    setUnreads(counts);
    setLoading(false);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Spaces</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Signed in as {profile?.name}
          </ThemedText>
          <View style={styles.actions}>
            <View style={styles.grow}>
              <Button label="New space" onPress={() => router.push('/space/new')} />
            </View>
            <View style={styles.grow}>
              <Button label="Join" kind="secondary" onPress={() => router.push('/join')} />
            </View>
          </View>
        </View>
        <FlatList
          data={rows.filter((r) => r.spaces)}
          keyExtractor={(r) => r.spaces!.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          renderItem={({ item }) => {
            const color = colorForUser(item.spaces!.id);
            return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/space/[id]', params: { id: item.spaces!.id } })}
              style={({ pressed }) => [
                styles.row,
                { borderColor: theme.border, borderLeftColor: color, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
              ]}>
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {item.spaces!.name.slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <View style={styles.grow}>
                <View style={styles.rowTop}>
                  <ThemedText type="smallBold" style={[styles.rowTitle, styles.grow]} numberOfLines={1}>
                    {item.spaces!.name}
                  </ThemedText>
                  {unreads[item.spaces!.id] > 0 ? (
                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                      <ThemedText type="small" style={{ color: theme.accentText }}>
                        {unreads[item.spaces!.id]}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {TEMPLATES.find((t) => t.key === item.spaces!.template)?.label ?? 'Space'} · {roleLabel(item.role)}
                </ThemedText>
              </View>
            </Pressable>
            );
          }}
          ListEmptyComponent={
            loading ? undefined : (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="smallBold">No spaces yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Create one for your group, or join with an invite link from a friend.
                </ThemedText>
              </ThemedView>
            )
          }
          ListFooterComponent={
            <View style={styles.footer}>
              <Button label="Sign out" kind="secondary" onPress={signOut} />
            </View>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.half,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 14, borderWidth: 1, borderLeftWidth: 5, padding: Spacing.three },
  avatar: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowTitle: { fontSize: 16 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  empty: { borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
  footer: { paddingTop: Spacing.four },
  actions: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two },
  grow: { flex: 1 },
});
