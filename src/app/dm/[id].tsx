import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, DaySeparator, dayLabel } from '@/components/space-chat';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type DmMessage } from '@/lib/dm';
import { useAuth } from '@/lib/auth';
import { notifyDm, setActiveChat } from '@/lib/notifications';
import { friendlyError, supabase } from '@/lib/supabase';

const PAGE = 40;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();

type Row = { kind: 'day'; id: string; label: string } | { kind: 'msg'; id: string; item: DmMessage; last: boolean };

/** Newest-first messages into inverted-list rows: a day label above each day, and a tail on the last bubble of a run. */
function buildRows(items: DmMessage[], hasMore: boolean): Row[] {
  const now = new Date();
  const rows: Row[] = [];
  items.forEach((item, i) => {
    const newer = items[i - 1];
    const older = items[i + 1];
    const last = !newer || newer.sender_id !== item.sender_id || dayKey(newer.created_at) !== dayKey(item.created_at);
    rows.push({ kind: 'msg', id: item.id, item, last });
    if (older ? dayKey(older.created_at) !== dayKey(item.created_at) : !hasMore) {
      rows.push({ kind: 'day', id: `day-${dayKey(item.created_at)}`, label: dayLabel(item.created_at, now) });
    }
  });
  return rows;
}

export default function DmThreadScreen() {
  const theme = useTheme();
  const { session, profile } = useAuth();
  const me = session?.user.id;
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const id = params.id;
  const [name, setName] = useState(params.name ?? 'Chat');
  const [otherId, setOtherId] = useState<string | null>(null);
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

  // The other person's id (for their avatar colour), and their name if we arrived without it.
  useEffect(() => {
    supabase
      .rpc('dm_thread_head', { p_thread: id })
      .maybeSingle()
      .then(({ data }) => {
        const head = data as { other_id: string; other_name: string } | null;
        if (head?.other_id) setOtherId(head.other_id);
        if (head?.other_name && !params.name) setName(head.other_name);
      });
  }, [id, params.name]);

  // While this chat is open its notifications are read: clear them, and don't show new ones.
  useFocusEffect(
    useCallback(() => {
      setActiveChat({ threadId: id, title: name });
      return () => setActiveChat(null);
    }, [id, name]),
  );

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

  const rows = useMemo(() => buildRows(items, hasMore), [items, hasMore]);
  const canSend = !!draft.trim() && !sending;

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
            hitSlop={12}
            style={styles.backBtn}>
            <ThemedText style={styles.backGlyph}>‹</ThemedText>
          </Pressable>
          <Avatar userId={otherId ?? id} name={name} size={38} />
          <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
            {name}
          </ThemedText>
        </View>

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item: row }) =>
              row.kind === 'day' ? <DaySeparator label={row.label} /> : <Bubble item={row.item} mine={row.item.sender_id === me} last={row.last} />
            }
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
              <View style={[styles.inputPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <TextInput
                  accessibilityLabel="Message"
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={`Message ${name.split(' ')[0]}`}
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  maxLength={2000}
                  style={[styles.input, { color: theme.text }]}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={!canSend}
                onPress={send}
                style={[styles.sendBtn, { backgroundColor: theme.accent, opacity: canSend ? 1 : 0.4 }]}>
                <ThemedText style={[styles.sendGlyph, { color: theme.accentText }]}>➤</ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Bubble({ item, mine, last }: { item: DmMessage; mine: boolean; last: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: mine ? theme.accentSoft : theme.backgroundElement },
          last && (mine ? styles.tailRight : styles.tailLeft),
        ]}>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, lineHeight: 36 },
  title: { flex: 1, fontSize: 18, lineHeight: 24 },
  list: { paddingHorizontal: Spacing.two + 2, paddingVertical: Spacing.two, gap: 6, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, transform: [{ scaleY: -1 }] },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, gap: 2 },
  tailLeft: { borderBottomLeftRadius: 4 },
  tailRight: { borderBottomRightRadius: 4 },
  time: { alignSelf: 'flex-end', fontSize: 11, lineHeight: 14 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: Spacing.one },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  inputPill: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, paddingHorizontal: Spacing.three },
  input: { minHeight: 46, maxHeight: 120, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { fontSize: 20, lineHeight: 24, marginLeft: 3 },
});
