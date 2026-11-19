import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type DmMessage } from '@/lib/dm';
import { useAuth } from '@/lib/auth';
import { notifyDm } from '@/lib/notifications';
import { friendlyError, supabase } from '@/lib/supabase';

const PAGE = 40;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function DmThreadScreen() {
  const theme = useTheme();
  const { session, profile } = useAuth();
  const me = session?.user.id;
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const [name, setName] = useState(params.name ?? 'Chat');
  const [items, setItems] = useState<DmMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadingMore = useRef(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('dm_thread_messages', { p_thread: id, p_limit: PAGE });
    const fresh = (data as DmMessage[] | null) ?? [];
    setItems((cur) => {
      if (!cur.length) {
        setHasMore(fresh.length === PAGE);
        return fresh;
      }
      const oldest = fresh.length === PAGE ? fresh[fresh.length - 1].created_at : null;
      const kept = cur.filter((c) => !fresh.some((n) => n.id === c.id) && oldest !== null && c.created_at < oldest);
      return [...fresh, ...kept];
    });
    supabase.rpc('dm_mark_read', { p_thread: id });
  }, [id]);

  async function loadMore() {
    if (!hasMore || loadingMore.current || !items.length) return;
    loadingMore.current = true;
    const { data } = await supabase.rpc('dm_thread_messages', {
      p_thread: id,
      p_before: items[items.length - 1].created_at,
      p_limit: PAGE,
    });
    const older = (data as DmMessage[] | null) ?? [];
    setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
    setHasMore(older.length === PAGE);
    loadingMore.current = false;
  }

  // Fill in the other person's name if we arrived without it.
  useEffect(() => {
    if (params.name) return;
    supabase
      .rpc('dm_thread_head', { p_thread: id })
      .maybeSingle()
      .then(({ data }) => {
        const head = data as { other_name: string } | null;
        if (head?.other_name) setName(head.other_name);
      });
  }, [id, params.name]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Live: new messages in this thread appear at once.
  useEffect(() => {
    const channel = supabase
      .channel(`dm:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    const { error: err } = await supabase.rpc('dm_send', { p_thread: id, p_body: body });
    setSending(false);
    if (err) setError(friendlyError(err));
    else {
      notifyDm(id, profile?.name || 'New message', body);
      setDraft('');
      refresh();
    }
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
            hitSlop={12}
            style={[styles.iconBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.backGlyph}>‹</ThemedText>
          </Pressable>
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            {name}
          </ThemedText>
        </View>

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <FlatList
            inverted
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) => <Bubble item={item} mine={item.sender_id === me} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <ThemedText type="smallBold">No messages yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Send the first message to {name}.
                </ThemedText>
              </View>
            }
          />

          <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <ErrorText>{error}</ErrorText>
            <View style={styles.composerRow}>
              <TextInput
                accessibilityLabel="Message"
                value={draft}
                onChangeText={setDraft}
                placeholder="Message"
                placeholderTextColor={theme.textSecondary}
                multiline
                maxLength={2000}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={!draft.trim() || sending}
                onPress={send}
                style={[styles.iconBtn, { backgroundColor: theme.positive, opacity: !draft.trim() || sending ? 0.5 : 1, borderColor: theme.positive }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  ↑
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Bubble({ item, mine }: { item: DmMessage; mine: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <View style={[styles.bubble, { backgroundColor: mine ? theme.accentSoft : theme.backgroundElement }]}>
        <ThemedText>{item.body}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
          {time(item.created_at)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 28, lineHeight: 30 },
  title: { flex: 1, fontSize: 18 },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, transform: [{ scaleY: -1 }] },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 2 },
  time: { alignSelf: 'flex-end', fontSize: 11 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: Spacing.one },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
});
