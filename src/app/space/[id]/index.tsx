import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { derive, summarize, type ActivityField, type Vals } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { friendlyError, supabase } from '@/lib/supabase';

type FeedItem = {
  kind: 'checkin' | 'message';
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  body: string | null;
  type_label: string | null;
  derive_kind: string | null;
  vals: Vals | null;
  fields: ActivityField[] | null;
  photo_path: string | null;
  cheers: number;
  cheered: boolean;
};
type SpaceHead = { name: string; chat_enabled: boolean; posts_per_hour: number };
type Today = { members: number; done: number; checkins: number };

const PAGE = 40;

export default function SpaceFeedScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<SpaceHead | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadingMore = useRef(false);

  const signPhotos = useCallback(async (rows: FeedItem[]) => {
    const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
    if (!paths.length) return;
    const { data } = await supabase.storage.from('proofs').createSignedUrls(paths, 60 * 60);
    if (!data) return;
    setPhotos((cur) => {
      const next = { ...cur };
      for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
      return next;
    });
  }, []);

  /** Reloads the newest page and the header numbers, keeping older pages already loaded. */
  const refresh = useCallback(async () => {
    const [s, t, f] = await Promise.all([
      supabase.from('spaces').select('name, chat_enabled, posts_per_hour').eq('id', id).maybeSingle(),
      supabase.rpc('space_today', { p_space: id }).maybeSingle(),
      supabase.rpc('space_feed', { p_space: id, p_limit: PAGE }),
    ]);
    setSpace(s.data as SpaceHead | null);
    setToday(t.data as Today | null);
    const fresh = (f.data as FeedItem[] | null) ?? [];
    setItems((cur) => {
      if (!cur.length) {
        setHasMore(fresh.length === PAGE);
        return fresh;
      }
      const oldest = fresh.length === PAGE ? fresh[fresh.length - 1].created_at : null;
      const kept = cur.filter((c) => !fresh.some((n) => n.id === c.id) && oldest !== null && c.created_at < oldest);
      return [...fresh, ...kept];
    });
    signPhotos(fresh);
  }, [id, signPhotos]);

  async function loadMore() {
    if (!hasMore || loadingMore.current || !items.length) return;
    loadingMore.current = true;
    const { data } = await supabase.rpc('space_feed', {
      p_space: id,
      p_before: items[items.length - 1].created_at,
      p_limit: PAGE,
    });
    const older = (data as FeedItem[] | null) ?? [];
    setItems((cur) => [...cur, ...older.filter((o) => !cur.some((c) => c.id === o.id))]);
    setHasMore(older.length === PAGE);
    signPhotos(older);
    loadingMore.current = false;
  }

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Live updates: any new check-in, message or cheer in this space refreshes the newest page.
  useEffect(() => {
    const channel = supabase
      .channel(`space:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkins', filter: `space_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `space_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cheers' }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError('');
    const { error: err } = await supabase.rpc('send_message', { p_space: id, p_body: body });
    setSending(false);
    if (err) setError(friendlyError(err));
    else {
      setDraft('');
      refresh();
    }
  }

  async function cheer(item: FeedItem) {
    // Show the change at once; the live update brings the real count.
    setItems((cur) =>
      cur.map((c) => (c.id === item.id ? { ...c, cheered: !c.cheered, cheers: c.cheers + (c.cheered ? -1 : 1) } : c)),
    );
    const { error: err } = await supabase.rpc('toggle_cheer', { p_checkin: item.id });
    if (err) refresh();
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={12}
            style={[styles.iconBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText style={styles.backGlyph}>‹</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${space?.name ?? 'Space'}, open space info`}
            onPress={() => router.push({ pathname: '/space/[id]/info', params: { id } })}
            style={styles.titles}>
            <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
              {space?.name ?? ' '}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {today ? `${today.done} of ${today.members} done today · tap for info` : 'Tap for info'}
            </ThemedText>
          </Pressable>
        </View>

        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            inverted
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) =>
              item.kind === 'message' ? (
                <MessageBubble item={item} mine={item.user_id === me} />
              ) : (
                <CheckinCard item={item} mine={item.user_id === me} photo={item.photo_path ? photos[item.photo_path] : undefined} onCheer={() => cheer(item)} />
              )
            }
            ListHeaderComponent={
              today ? (
                <View style={[styles.today, { backgroundColor: theme.positiveSoft }]}>
                  <ThemedText type="smallBold" style={{ color: theme.positive }}>
                    Today in numbers
                  </ThemedText>
                  <ThemedText type="small">
                    {today.done} of {today.members} members checked in · {today.checkins} check-in{today.checkins === 1 ? '' : 's'}
                  </ThemedText>
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              space ? (
                <View style={styles.empty}>
                  <ThemedText type="smallBold">Nothing here yet</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Log the first activity to start the streak.
                  </ThemedText>
                </View>
              ) : undefined
            }
          />

          <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <ErrorText>{error}</ErrorText>
            <View style={styles.composerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log activity"
                onPress={() => router.push({ pathname: '/space/[id]/log', params: { id } })}
                style={[styles.logBtn, { backgroundColor: theme.accent }, !space?.chat_enabled && styles.grow]}>
                <ThemedText type="smallBold" style={{ color: theme.accentText }}>
                  {space?.chat_enabled ? '+ Log' : '+ Log activity'}
                </ThemedText>
              </Pressable>
              {space?.chat_enabled ? (
                <>
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
                </>
              ) : null}
            </View>
            {space && !space.chat_enabled ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Group chat is off in this space. Only check-ins can be posted.
              </ThemedText>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function MessageBubble({ item, mine }: { item: FeedItem; mine: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <View style={[styles.bubble, { backgroundColor: mine ? theme.accentSoft : theme.backgroundElement }]}>
        {!mine ? (
          <ThemedText type="smallBold" style={{ color: theme.positive }}>
            {item.name}
          </ThemedText>
        ) : null}
        <ThemedText>{item.body}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
          {time(item.created_at)}
        </ThemedText>
      </View>
    </View>
  );
}

function CheckinCard({ item, mine, photo, onCheer }: { item: FeedItem; mine: boolean; photo?: string; onCheer: () => void }) {
  const theme = useTheme();
  const vals = item.vals ?? {};
  const summary = summarize(item.fields ?? [], vals);
  const derived = derive(item.derive_kind, vals);
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardHead}>
        <ThemedText type="smallBold" style={styles.grow}>
          {mine ? 'You' : item.name} · {item.type_label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {time(item.created_at)}
        </ThemedText>
      </View>
      {summary ? <ThemedText style={styles.summary}>{summary}</ThemedText> : null}
      {derived ? (
        <ThemedText type="smallBold" style={{ color: theme.positive }}>
          {derived}
        </ThemedText>
      ) : null}
      {item.body ? <ThemedText type="small">{item.body}</ThemedText> : null}
      {item.photo_path ? (
        photo ? (
          <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" accessibilityLabel={`Proof photo from ${item.name}`} />
        ) : (
          <View style={[styles.photo, { backgroundColor: theme.backgroundSelected }]} />
        )
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.cheered ? 'Remove cheer' : 'Cheer'}
        accessibilityState={{ selected: item.cheered }}
        onPress={onCheer}
        style={[
          styles.cheer,
          { borderColor: item.cheered ? theme.accent : theme.border, backgroundColor: item.cheered ? theme.accentSoft : theme.background },
        ]}>
        <ThemedText type="small">👏 {item.cheers > 0 ? item.cheers : 'Cheer'}</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
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
  titles: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  title: { fontSize: 18 },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  today: { borderRadius: 14, padding: Spacing.three, gap: Spacing.half },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, transform: [{ scaleY: -1 }] },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 2 },
  time: { alignSelf: 'flex-end', fontSize: 11 },
  card: { borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.one },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summary: { fontSize: 18, fontWeight: '600' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10, marginTop: Spacing.one },
  cheer: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, minHeight: 36, justifyContent: 'center', marginTop: Spacing.one },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: Spacing.one },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  logBtn: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
});
