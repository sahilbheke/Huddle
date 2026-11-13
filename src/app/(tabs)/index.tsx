import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type SpaceRow = { role: 'owner' | 'admin' | 'member'; spaces: { id: string; name: string; template: string } | null };

export default function SpacesScreen() {
  const theme = useTheme();
  const { profile, session, signOut } = useAuth();
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('space_members')
      .select('role, spaces(id, name, template)')
      .eq('user_id', session!.user.id)
      .order('joined_at', { ascending: false });
    setRows((data as SpaceRow[] | null) ?? []);
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
        </View>
        <FlatList
          data={rows.filter((r) => r.spaces)}
          keyExtractor={(r) => r.spaces!.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.border }]}>
              <ThemedText type="smallBold" style={styles.rowTitle}>
                {item.spaces!.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.role === 'member' ? 'Member' : item.role === 'owner' ? 'Owner' : 'Admin'}
              </ThemedText>
            </ThemedView>
          )}
          ListEmptyComponent={
            loading ? undefined : (
              <ThemedView type="backgroundElement" style={styles.empty}>
                <ThemedText type="smallBold">No spaces yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Creating a space and joining one with an invite link come in the next update.
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
  row: { borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.half },
  rowTitle: { fontSize: 16 },
  empty: { borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
  footer: { paddingTop: Spacing.four },
});
