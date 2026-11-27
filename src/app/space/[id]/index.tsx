import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedPhoto } from '@/components/feed-photo';
import { Avatar, Celebration, CheerButton, DaySeparator, Nudge, TeamPulse, dayLabel, type PulseMember } from '@/components/space-chat';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ErrorText } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { colorForUser, derive, summarize, type ActivityField, type Vals } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { notifySpace, setActiveChat } from '@/lib/notifications';
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
type Row =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'post'; id: string; item: FeedItem; first: boolean; last: boolean };

const QUICK_BEFORE = ['💪 Doing mine today', '👏 Great work, team', "🔥 Let's go"];
const QUICK_AFTER = ['👏 Great work, team', '✅ Done for today', "💪 Who's next?"];

const PAGE = 40;

export default function SpaceFeedScreen() {
  const theme = useTheme();
  const { session, profile } = useAuth();
  const me = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<SpaceHead | null>(null);
  const [team, setTeam] = useState<PulseMember[] | null>(null);
  const [hideNudge, setHideNudge] = useState(false);
  const [celebrate, setCelebrate] = useState<number | null>(null);
  const wasDone = useRef<boolean | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [iLeft, setILeft] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const loadingMore = useRef(false);
  const photoUrls = usePhotoUrls(items.map((i) => i.photo_path));

  /** Reloads the newest page and the header numbers, keeping older pages already loaded. */
  const refresh = useCallback(async () => {
    const [s, b, f, mem, roster] = await Promise.all([
      supabase.from('spaces').select('name, chat_enabled, posts_per_hour').eq('id', id).maybeSingle(),
      supabase.rpc('space_board', { p_space: id }),
      supabase.rpc('space_feed', { p_space: id, p_limit: PAGE }),
      supabase.from('space_members').select('left_at').eq('space_id', id).eq('user_id', me ?? '').maybeSingle(),
      supabase.from('space_members').select('user_id').eq('space_id', id).not('left_at', 'is', null),
    ]);
    setSpace(s.data as SpaceHead | null);
    // Only people still in the space count toward today's rings.
    const gone = new Set(((roster.data as { user_id: string }[] | null) ?? []).map((r) => r.user_id));
    const members = ((b.data as PulseMember[] | null) ?? []).filter((m) => !gone.has(m.user_id));
    setTeam(b.error ? null : members);
    // Just came back from logging? Celebrate the streak once.
    const mine = members.find((m) => m.user_id === me);
    if (mine) {
      if (wasDone.current === false && mine.done_today) setCelebrate(mine.streak);
      wasDone.current = mine.done_today;
    }
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

  // While this space is open its notifications are read: clear them, and don't show new ones.
  const spaceName = space?.name;
  useFocusEffect(
    useCallback(() => {
      setActiveChat({ spaceId: id, title: spaceName });
      return () => setActiveChat(null);
    }, [id, spaceName]),
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

  const mine = team?.find((m) => m.user_id === me);
  const doneToday = !!mine?.done_today;
  const doneCount = team?.filter((m) => m.done_today).length ?? 0;
  const hasDraft = !!draft.trim() || !!photo;
  const rows = useMemo(() => buildRows(items, hasMore), [items, hasMore]);
  // The activity name only helps when a space has more than one kind.
  const multiType = useMemo(() => new Set(items.filter((i) => i.kind === 'checkin').map((i) => i.type_label)).size > 1, [items]);
  const openLog = () => router.push({ pathname: '/space/[id]/log', params: { id } });
  const endCelebration = useCallback(() => setCelebrate(null), []);

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: team?.length ? 'transparent' : theme.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={12}
            style={styles.backBtn}>
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
                {mine && mine.streak > 0 ? (
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    🔥 {mine.streak}-day streak
                  </ThemedText>
                ) : team?.length ? (
                  `${doneCount} of ${team.length} in today`
                ) : null}
                {team?.length ? ' · tap for info' : 'Tap for info'}
              </ThemedText>
            </View>
          </Pressable>
        </View>
        {team?.length && !iLeft ? <TeamPulse members={team} me={me} /> : null}

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <View style={styles.fill}>
            <FlatList
              inverted
              data={rows}
              keyExtractor={(r) => r.id}
              contentContainerStyle={styles.list}
              onEndReached={loadMore}
              onEndReachedThreshold={0.4}
              renderItem={({ item: row }) => {
                if (row.kind === 'day') return <DaySeparator label={row.label} />;
                const { item, first, last } = row;
                const photoUri = item.photo_path ? photoUrls[item.photo_path] : undefined;
                return item.kind === 'message' ? (
                  <MessageBubble item={item} mine={item.user_id === me} first={first} last={last} photo={photoUri} onLongPress={() => manage(item)} />
                ) : (
                  <CheckinCard
                    item={item}
                    mine={item.user_id === me}
                    showType={multiType}
                    photo={photoUri}
                    onCheer={() => cheer(item)}
                    onLongPress={() => manage(item)}
                  />
                );
              }}
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
            {celebrate !== null ? (
              <Celebration title={`Day ${celebrate} 🔥`} body="Streak kept. Your team can see it." onDone={endCelebration} />
            ) : null}
          </View>

          {team && !iLeft && !hideNudge ? <Nudge members={team} me={me} onLog={openLog} onDismiss={() => setHideNudge(true)} /> : null}

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
                {space?.chat_enabled ? (
                  <>
                    {typing && !hasDraft ? (
                      <ScrollView
                        horizontal
                        keyboardShouldPersistTaps="handled"
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.quick}
                        accessibilityLabel="Quick replies">
                        {(doneToday ? QUICK_AFTER : QUICK_BEFORE).map((q) => (
                          <Pressable
                            key={q}
                            accessibilityRole="button"
                            accessibilityHint="Puts this text in the message box"
                            onPress={() => setDraft(q)}
                            style={[styles.quickChip, { borderColor: theme.border, backgroundColor: theme.background }]}>
                            <ThemedText type="small">{q}</ThemedText>
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}
                    <View style={styles.composerRow}>
                      <View style={[styles.inputPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                        <TextInput
                          accessibilityLabel="Message"
                          value={draft}
                          onChangeText={setDraft}
                          onFocus={() => setTyping(true)}
                          onBlur={() => setTyping(false)}
                          placeholder="Message the group"
                          placeholderTextColor={theme.textSecondary}
                          multiline
                          maxLength={2000}
                          style={[styles.input, { color: theme.text }]}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Add a photo"
                          onPress={attach}
                          disabled={sending}
                          hitSlop={6}
                          style={styles.cameraBtn}>
                          <ThemedText style={styles.cameraGlyph}>📷</ThemedText>
                        </Pressable>
                      </View>
                      {hasDraft ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Send"
                          disabled={sending}
                          onPress={send}
                          style={[styles.roundBtn, { backgroundColor: theme.accent, opacity: sending ? 0.6 : 1 }]}>
                          <ThemedText style={[styles.sendGlyph, { color: theme.accentText }]}>➤</ThemedText>
                        </Pressable>
                      ) : doneToday ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Log another activity"
                          onPress={openLog}
                          style={[styles.roundBtn, { backgroundColor: theme.accent }]}>
                          <ThemedText style={[styles.plusGlyph, { color: theme.accentText }]}>+</ThemedText>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Log activity"
                          onPress={openLog}
                          style={[styles.logPill, { backgroundColor: theme.accent }]}>
                          <ThemedText style={[styles.plusGlyph, { color: theme.accentText }]}>+</ThemedText>
                          <ThemedText type="smallBold" style={[styles.logText, { color: theme.accentText }]}>
                            Log
                          </ThemedText>
                        </Pressable>
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Log activity"
                      onPress={openLog}
                      style={[styles.logPill, styles.logWide, { backgroundColor: doneToday ? theme.backgroundElement : theme.accent }]}>
                      <ThemedText type="smallBold" style={[styles.logText, { color: doneToday ? theme.text : theme.accentText }]}>
                        {doneToday ? '+ Log another' : '+ Log today'}
                      </ThemedText>
                    </Pressable>
                    {space ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                        Group chat is off in this space. Only check-ins can be posted.
                      </ThemedText>
                    ) : null}
                  </>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();

/**
 * Turns the newest-first feed into list rows for the inverted list: a day label above each
 * day's first post, and first/last flags so a run of posts by one person shows their name
 * once at the top and their face once at the bottom.
 */
function buildRows(items: FeedItem[], hasMore: boolean): Row[] {
  const now = new Date();
  const same = (a?: FeedItem, b?: FeedItem) =>
    !!a && !!b && a.user_id === b.user_id && a.kind === 'message' && b.kind === 'message' && dayKey(a.created_at) === dayKey(b.created_at);
  const rows: Row[] = [];
  items.forEach((item, i) => {
    const newer = items[i - 1];
    const older = items[i + 1];
    rows.push({ kind: 'post', id: item.id, item, first: !same(item, older), last: !same(item, newer) });
    // Older pages may still hold more of this day, so wait for them before labelling it.
    if (older ? dayKey(older.created_at) !== dayKey(item.created_at) : !hasMore) {
      rows.push({ kind: 'day', id: `day-${dayKey(item.created_at)}`, label: dayLabel(item.created_at, now) });
    }
  });
  return rows;
}

type PostProps = { item: FeedItem; mine: boolean; photo?: string | null; onLongPress: () => void };

function MessageBubble({ item, mine, first, last, photo, onLongPress }: PostProps & { first: boolean; last: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, mine && styles.mineRow]}>
      {!mine ? last ? <Avatar userId={item.user_id} name={item.name} /> : <View style={styles.avatarGap} /> : null}
      <Pressable
        onLongPress={onLongPress}
        style={[
          styles.bubble,
          item.photo_path && styles.photoBubble,
          { backgroundColor: mine ? theme.accentSoft : theme.backgroundElement },
          last && (mine ? styles.tailRight : styles.tailLeft),
        ]}>
        {!mine && first ? (
          <ThemedText type="smallBold" style={[styles.name, { color: colorForUser(item.user_id) }]} numberOfLines={1}>
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

function CheckinCard({ item, mine, showType, photo, onCheer, onLongPress }: PostProps & { showType: boolean; onCheer: () => void }) {
  const theme = useTheme();
  const vals = item.vals ?? {};
  const summary = summarize(item.fields ?? [], vals);
  const derived = derive(item.derive_kind, vals);
  const label = showType ? item.type_label : null;
  return (
    <View style={[styles.row, mine && styles.mineRow]}>
      {!mine ? <Avatar userId={item.user_id} name={item.name} /> : null}
      <Pressable
        onLongPress={onLongPress}
        accessibilityLabel={`${mine ? 'You' : item.name} checked in${summary ? `: ${summary}` : ''}`}
        style={[
          styles.card,
          item.photo_path && styles.photoBubble,
          mine
            ? [styles.tailRight, { backgroundColor: theme.accentSoft, borderColor: theme.accentSoft }]
            : [styles.tailLeft, { backgroundColor: theme.backgroundElement, borderColor: theme.border }],
        ]}>
        {!mine || label ? (
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {!mine ? <ThemedText type="smallBold" style={{ color: colorForUser(item.user_id) }}>{item.name}</ThemedText> : null}
            {label ? <ThemedText type="small" themeColor="textSecondary">{!mine ? ` · ${label}` : label}</ThemedText> : null}
          </ThemedText>
        ) : null}
        <View style={styles.bigRow}>
          <View style={[styles.doneDot, { backgroundColor: theme.positive }]}>
            <ThemedText style={[styles.doneTick, { color: theme.background }]}>✓</ThemedText>
          </View>
          <ThemedText style={styles.summary}>{summary || item.type_label || 'Checked in'}</ThemedText>
        </View>
        {derived ? (
          <ThemedText type="smallBold" style={{ color: theme.positive }}>
            {derived}
          </ThemedText>
        ) : null}
        {item.photo_path ? <FeedPhoto uri={photo} label={`Proof photo from ${mine ? 'you' : item.name}`} /> : null}
        {item.body ? <ThemedText type="small">{item.body}</ThemedText> : null}
        <View style={styles.cardFoot}>
          {mine ? (
            item.cheers > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                👏 {item.cheers} {item.cheers === 1 ? 'cheer' : 'cheers'}
              </ThemedText>
            ) : null
          ) : (
            <CheerButton count={item.cheers} cheered={item.cheered} onPress={onCheer} label />
          )}
          <ThemedText type="small" themeColor="textSecondary" style={styles.footTime}>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, lineHeight: 36 },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  headAvatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0, justifyContent: 'center' },
  title: { fontSize: 18, lineHeight: 24 },
  list: { paddingHorizontal: Spacing.two + 2, paddingVertical: Spacing.two, gap: 6, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five, transform: [{ scaleY: -1 }] },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  mineRow: { justifyContent: 'flex-end' },
  avatarGap: { width: 28 },
  photoBubble: { width: '75%' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, gap: 2 },
  tailLeft: { borderBottomLeftRadius: 4 },
  tailRight: { borderBottomRightRadius: 4 },
  name: { fontSize: 13, lineHeight: 18 },
  time: { alignSelf: 'flex-end', fontSize: 11, lineHeight: 14 },
  card: { maxWidth: '78%', borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  bigRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  doneDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  doneTick: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  summary: { fontSize: 20, lineHeight: 26, fontWeight: '700', flexShrink: 1 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  footTime: { marginLeft: 'auto', fontSize: 11, lineHeight: 14 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  attachThumb: { width: 48, height: 48, borderRadius: 8 },
  leftBanner: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.two, marginTop: Spacing.two },
  quick: { gap: Spacing.two, paddingHorizontal: 2 },
  quickChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  inputPill: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', minHeight: 48, borderRadius: 24, borderWidth: 1, paddingLeft: Spacing.three, paddingRight: 4 },
  input: { flex: 1, minHeight: 46, maxHeight: 120, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
  cameraBtn: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  cameraGlyph: { fontSize: 20, lineHeight: 26 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { fontSize: 20, lineHeight: 24, marginLeft: 3 },
  plusGlyph: { fontSize: 24, lineHeight: 28, fontWeight: '700' },
  logPill: { height: 48, borderRadius: 24, paddingLeft: 14, paddingRight: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  logWide: { alignSelf: 'stretch' },
  logText: { fontSize: 16, lineHeight: 22 },
});
