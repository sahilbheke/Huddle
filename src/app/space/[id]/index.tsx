import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedPhoto } from '@/components/feed-photo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { colorForUser, derive, summarize, type ActivityField, type Vals } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { notifySpace } from '@/lib/notifications';
import { pickPhoto, removePhotos, uploadPhoto, usePhotoUrls, type Photo } from '@/lib/photos';
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
  const { session, profile } = useAuth();
  const me = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<SpaceHead | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [iLeft, setILeft] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadingMore = useRef(false);
  const photoUrls = usePhotoUrls(items.map((i) => i.photo_path));

  /** Reloads the newest page and the header numbers, keeping older pages already loaded. */
  const refresh = useCallback(async () => {
    const [s, t, f, mem] = await Promise.all([
      supabase.from('spaces').select('name, chat_enabled, posts_per_hour').eq('id', id).maybeSingle(),
      supabase.rpc('space_today', { p_space: id }).maybeSingle(),
      supabase.rpc('space_feed', { p_space: id, p_limit: PAGE }),
      supabase.from('space_members').select('left_at').eq('space_id', id).eq('user_id', me ?? '').maybeSingle(),
    ]);
    setSpace(s.data as SpaceHead | null);
    setToday(t.data as Today | null);
    const left = !!(mem.data as { left_at: string | null } | null)?.left_at;
    setILeft(left);
    if (!left) await supabase.rpc('mark_space_read', { p_space: id });
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
  }, [id, me]);

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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'checkins', filter: `space_id=eq.${id}` }, refresh)
      // Deletes can't be filtered by space, so drop the row locally instead of refetching.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        const gone = (payload.old as { id?: string }).id;
        if (gone) setItems((cur) => cur.filter((c) => c.id !== gone));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cheers' }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  async function send() {
    const body = draft.trim();
    if ((!body && !photo) || !me) return;
    setSending(true);
    setError('');
    let photoPath: string | null = null;
    if (photo) {
      const up = await uploadPhoto(id, me, photo);
      if ('error' in up) {
        setSending(false);
        setError(up.error);
        return;
      }
      photoPath = up.path;
    }
    const { error: err } = await supabase.rpc('send_message', { p_space: id, p_body: body || null, p_photo_path: photoPath });
    setSending(false);
    if (err) {
      // The message wasn't saved, so don't leave its photo behind in storage.
      removePhotos([photoPath]);
      setError(friendlyError(err));
    } else {
      const who = profile?.name || 'Someone';
      notifySpace(id, space?.name ?? 'Huddle', `${who}: ${body || '📷 Photo'}`);
      setDraft('');
      setPhoto(null);
      refresh();
    }
  }

  async function choosePhoto(source: 'camera' | 'library') {
    const res = await pickPhoto(source);
    if (!res) return;
    if ('error' in res) setError(res.error);
    else {
      setError('');
      setPhoto(res.photo);
    }
  }

  function attach() {
    // Web has no camera picker or multi-button alerts, so go straight to the file chooser.
    if (Platform.OS === 'web') return choosePhoto('library');
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => choosePhoto('camera') },
      { text: 'Choose from library', onPress: () => choosePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  /** Long-press on your own post: delete a message, or take the photo off a check-in. Either way the file is deleted. */
  function manage(item: FeedItem) {
    if (item.user_id !== me || iLeft) return;
    if (item.kind === 'message') {
      Alert.alert('Delete message?', item.photo_path ? 'The photo is deleted too.' : undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { data, error: err } = await supabase.rpc('delete_message', { p_message: item.id });
            if (err) return setError(friendlyError(err));
            await removePhotos([data as string | null]);
            setItems((cur) => cur.filter((c) => c.id !== item.id));
          },
        },
      ]);
    } else if (item.photo_path) {
      Alert.alert('Remove photo?', 'The check-in stays; only the photo is deleted.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove photo',
          style: 'destructive',
          onPress: async () => {
            const { data, error: err } = await supabase.rpc('remove_checkin_photo', { p_checkin: item.id });
            if (err) return setError(friendlyError(err));
            await removePhotos([data as string | null]);
            setItems((cur) => cur.map((c) => (c.id === item.id ? { ...c, photo_path: null } : c)));
          },
        },
      ]);
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
            style={styles.titleRow}>
            <View style={[styles.headAvatar, { backgroundColor: colorForUser(id) }]}>
              <ThemedText type="smallBold" style={{ color: '#fff' }}>
                {(space?.name ?? ' ').slice(0, 1).toUpperCase()}
              </ThemedText>
            </View>
            <View style={styles.titles}>
              <ThemedText type="smallBold" style={styles.title} numberOfLines={1}>
                {space?.name ?? ' '}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {today ? `${today.done} of ${today.members} done today · tap for info` : 'Tap for info'}
              </ThemedText>
            </View>
          </Pressable>
        </View>

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <FlatList
            inverted
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) =>
              item.kind === 'message' ? (
                <MessageBubble item={item} mine={item.user_id === me} photo={item.photo_path ? photoUrls[item.photo_path] : undefined} onLongPress={() => manage(item)} />
              ) : (
                <CheckinCard
                  item={item}
                  mine={item.user_id === me}
                  photo={item.photo_path ? photoUrls[item.photo_path] : undefined}
                  onCheer={() => cheer(item)}
                  onLongPress={() => manage(item)}
                />
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
            {iLeft ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/space/[id]/info', params: { id } })}
                style={styles.leftBanner}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  You left this space — history is read-only. Tap the name to delete it from your list.
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <ErrorText>{error}</ErrorText>
                {photo ? (
                  <View style={styles.attachRow}>
                    <Image source={{ uri: photo.uri }} style={styles.attachThumb} contentFit="cover" accessibilityLabel="Photo to send" />
                    <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                      Photo attached. Add a caption or send it as is.
                    </ThemedText>
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhoto(null)} hitSlop={12}>
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        ✕
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : null}
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
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add a photo"
                        onPress={attach}
                        disabled={sending}
                        style={[styles.iconBtn, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                        <ThemedText>📷</ThemedText>
                      </Pressable>
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
                        disabled={(!draft.trim() && !photo) || sending}
                        onPress={send}
                        style={[
                          styles.iconBtn,
                          { backgroundColor: theme.positive, opacity: (!draft.trim() && !photo) || sending ? 0.5 : 1, borderColor: theme.positive },
                        ]}>
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
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

type PostProps = { item: FeedItem; mine: boolean; photo?: string; onLongPress: () => void };

function MessageBubble({ item, mine, photo, onLongPress }: PostProps) {
  const theme = useTheme();
  return (
    <View style={[styles.bubbleRow, mine && styles.mineRow]}>
      <Pressable
        onLongPress={onLongPress}
        style={[styles.bubble, item.photo_path && styles.photoBubble, { backgroundColor: mine ? theme.accentSoft : theme.backgroundElement }]}>
        {!mine ? (
          <ThemedText type="smallBold" style={{ color: colorForUser(item.user_id) }}>
            {item.name}
          </ThemedText>
        ) : null}
        {item.photo_path ? <FeedPhoto uri={photo} label={`Photo from ${mine ? 'you' : item.name}`} /> : null}
        {item.body ? <ThemedText>{item.body}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
          {time(item.created_at)}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function CheckinCard({ item, mine, photo, onCheer, onLongPress }: PostProps & { onCheer: () => void }) {
  const theme = useTheme();
  const vals = item.vals ?? {};
  const summary = summarize(item.fields ?? [], vals);
  const derived = derive(item.derive_kind, vals);
  return (
    <View style={[styles.cardRow, mine && styles.mineRow]}>
      <Pressable
        onLongPress={onLongPress}
        style={[styles.card, item.photo_path && styles.photoBubble, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        <View style={styles.cardHead}>
          <ThemedText type="smallBold" style={[styles.grow, { color: mine ? theme.positive : colorForUser(item.user_id) }]} numberOfLines={1}>
            {mine ? 'You' : item.name}
          </ThemedText>
          {item.type_label ? (
            <ThemedText type="smallBold" style={{ color: theme.accent }} numberOfLines={1}>
              {item.type_label}
            </ThemedText>
          ) : null}
        </View>
        {summary ? <ThemedText style={styles.summary}>{summary}</ThemedText> : null}
        {derived ? (
          <ThemedText type="smallBold" style={{ color: theme.positive }}>
            {derived}
          </ThemedText>
        ) : null}
        {item.photo_path ? <FeedPhoto uri={photo} label={`Proof photo from ${mine ? 'you' : item.name}`} /> : null}
        {item.body ? <ThemedText type="small">{item.body}</ThemedText> : null}
        <View style={styles.cardFoot}>
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
          <ThemedText type="small" themeColor="textSecondary">
            {time(item.created_at)}
          </ThemedText>
        </View>
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
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  headAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0, justifyContent: 'center' },
  title: { fontSize: 18 },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  today: { borderRadius: 14, padding: Spacing.three, gap: Spacing.half },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, transform: [{ scaleY: -1 }] },
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  photoBubble: { width: '70%' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  attachThumb: { width: 48, height: 48, borderRadius: 8 },
  bubble: { maxWidth: '70%', borderRadius: 14, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 2 },
  time: { alignSelf: 'flex-end', fontSize: 11 },
  cardRow: { flexDirection: 'row' },
  card: { maxWidth: '70%', borderRadius: 14, borderWidth: 1, padding: Spacing.three, gap: Spacing.one },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summary: { fontSize: 18, fontWeight: '600' },
  cheer: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, minHeight: 36, justifyContent: 'center' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.one, gap: Spacing.two },
  leftBanner: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: Spacing.one },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  logBtn: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 16 },
});
