import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { colorForUser } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { roleLabel, type Role, type Space } from '@/lib/spaces';
import { friendlyError, supabase } from '@/lib/supabase';

type Member = { user_id: string; role: Role; left_at: string | null; profiles: { name: string } | null };
type ActivityType = { id: string; label: string; enabled: boolean; activity_fields: { label: string; state: string }[] };

export default function SpaceInfoScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [s, m, t] = await Promise.all([
      supabase.from('spaces').select('*').eq('id', id).maybeSingle(),
      supabase.from('space_members').select('user_id, role, left_at, profiles(name)').eq('space_id', id).order('joined_at'),
      supabase
        .from('activity_types')
        .select('id, label, enabled, activity_fields(label, state)')
        .eq('space_id', id)
        .order('sort'),
    ]);
    setSpace(s.data as Space | null);
    setMissing(!s.data);
    setMembers((m.data as Member[] | null) ?? []);
    setTypes((t.data as ActivityType[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (missing) {
    return (
      <Screen title="Space not found">
        <ThemedText themeColor="textSecondary">This space doesn&apos;t exist or you aren&apos;t a member.</ThemedText>
      </Screen>
    );
  }
  if (!space) return <Screen title="Loading…">{null}</Screen>;

  const link = Linking.createURL(`join/${space.invite_code}`);
  const mine = members.find((m) => m.user_id === session?.user.id);
  const iLeft = !!mine?.left_at;
  const myRole = iLeft ? undefined : mine?.role;
  const activeMembers = members.filter((m) => !m.left_at);

  async function invite() {
    await Share.share({ message: `Join "${space!.name}" on Huddle: ${link}\nOr enter the code ${space!.invite_code}` });
  }

  async function run(fn: () => PromiseLike<{ error: unknown }>, after: () => void) {
    setBusy(true);
    setError('');
    const { error: err } = await fn();
    setBusy(false);
    if (err) setError(friendlyError(err));
    else after();
  }

  // Leave/delete can't drop us back onto the now-gone space screen, so pop every
  // pushed screen and land on the Spaces tab. router.replace('/') would leave the
  // space feed still mounted underneath, which crashes the app on Android.
  function toSpaces() {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/');
  }

  function leave() {
    Alert.alert('Leave space?', `You'll stop posting in "${space!.name}" but can still read its history.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => run(() => supabase.rpc('leave_space', { p_space: id }), toSpaces) },
    ]);
  }

  function forget() {
    Alert.alert('Delete from your list?', `"${space!.name}" will be removed from your list. You can rejoin later with the invite code.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => supabase.rpc('forget_space', { p_space: id }), toSpaces) },
    ]);
  }

  function deleteSpace() {
    Alert.alert('Delete space for everyone?', `This permanently deletes "${space!.name}" and all its messages and check-ins for every member. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete space', style: 'destructive', onPress: () => run(() => supabase.rpc('delete_space', { p_space: id }), toSpaces) },
    ]);
  }

  function removeMember(m: Member) {
    Alert.alert('Remove member?', `Remove ${m.profiles?.name || 'this member'} from "${space!.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run(() => supabase.rpc('remove_member', { p_space: id, p_user: m.user_id }), load) },
    ]);
  }

  const enabled = types.filter((t) => t.enabled);

  return (
    <Screen title={space.name} subtitle={`${activeMembers.length} member${activeMembers.length === 1 ? '' : 's'} · ${iLeft ? 'you left this space' : `you are ${myRole ? roleLabel(myRole).toLowerCase() : 'a member'}`}`}>
      <ErrorText>{error}</ErrorText>
      {iLeft ? null : (
      <Section title="Invite friends">
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Anyone with this link or code can join.
          </ThemedText>
          <ThemedText type="code" style={[styles.code, { color: theme.text }]} selectable>
            {space.invite_code}
          </ThemedText>
          <Button label="Share invite link" onPress={invite} />
        </Card>
      </Section>
      )}

      <Section title="Agenda">
        <Card>
          <Rule text={`Log one activity every day.`} />
          <Rule
            text={
              space.rest_days_per_week === 0
                ? 'No rest days. Every day counts.'
                : `${space.rest_days_per_week} rest day${space.rest_days_per_week === 1 ? ' is' : 's are'} allowed each week, applied automatically.`
            }
          />
          <Rule
            text={
              space.posts_per_hour === 0
                ? 'No hourly post limit.'
                : `At most ${space.posts_per_hour} post${space.posts_per_hour === 1 ? '' : 's'} per hour per person.`
            }
          />
          <Rule text={space.chat_enabled ? 'Group chat is on.' : 'Group chat is off. Only check-ins can be posted.'} />
          <Rule
            text={`Counts as a check-in: ${enabled
              .map((t) => {
                const req = t.activity_fields.filter((f) => f.state === 'required').map((f) => f.label.toLowerCase());
                return req.length ? `${t.label} (needs ${req.join(' and ')})` : t.label;
              })
              .join('; ')}.`}
          />
        </Card>
      </Section>

      <Section title={`Members · ${activeMembers.length}`}>
        <Card>
          {activeMembers.map((m) => {
            const canRemove = (myRole === 'owner' || myRole === 'admin') && m.role !== 'owner' && m.user_id !== session?.user.id;
            return (
            <View key={m.user_id} style={styles.member}>
              <View style={[styles.avatar, { backgroundColor: colorForUser(m.user_id) }]}>
                <ThemedText type="smallBold" style={{ color: '#fff' }}>
                  {(m.profiles?.name || '?').slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <ThemedText style={styles.grow}>
                {m.profiles?.name || 'New member'}
                {m.user_id === session?.user.id ? ' (you)' : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {roleLabel(m.role)}
              </ThemedText>
              {canRemove ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.profiles?.name || 'member'}`}
                  disabled={busy}
                  onPress={() => removeMember(m)}
                  hitSlop={8}
                  style={[styles.remove, { borderColor: theme.danger }]}>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    Remove
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            );
          })}
        </Card>
      </Section>

      {iLeft ? null : (
      <Section title="More">
        <Button label="Board, streaks and records" onPress={() => router.push({ pathname: '/space/[id]/board', params: { id } })} />
        {myRole === 'owner' || myRole === 'admin' ? (
          <Button label="Admin & settings" kind="secondary" onPress={() => router.push({ pathname: '/space/[id]/admin', params: { id } })} />
        ) : null}
      </Section>
      )}

      <Section title={iLeft ? 'This space' : myRole === 'owner' ? 'Owner' : 'Leave'}>
        {iLeft ? (
          <Button label="Delete from my list" kind="destructive" onPress={forget} busy={busy} />
        ) : myRole === 'owner' ? (
          <Button label="Delete space for everyone" kind="destructive" onPress={deleteSpace} busy={busy} />
        ) : (
          <>
            <Button label="Leave space" kind="secondary" onPress={leave} busy={busy} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              You&apos;ll keep read-only access to the history and can delete it from your list afterwards.
            </ThemedText>
          </>
        )}
      </Section>
    </Screen>
  );
}

function Rule({ text }: { text: string }) {
  return <ThemedText type="small">• {text}</ThemedText>;
}

const styles = StyleSheet.create({
  code: { fontSize: 24, letterSpacing: 3, textTransform: 'none' },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  remove: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  hint: { marginTop: Spacing.one },
});
