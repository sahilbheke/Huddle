import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { roleLabel, type Role, type Space } from '@/lib/spaces';
import { supabase } from '@/lib/supabase';

type Member = { user_id: string; role: Role; profiles: { name: string } | null };
type ActivityType = { id: string; label: string; enabled: boolean; activity_fields: { label: string; state: string }[] };

export default function SpaceInfoScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [s, m, t] = await Promise.all([
      supabase.from('spaces').select('*').eq('id', id).maybeSingle(),
      supabase.from('space_members').select('user_id, role, profiles(name)').eq('space_id', id).order('joined_at'),
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
  const myRole = members.find((m) => m.user_id === session?.user.id)?.role;

  async function invite() {
    await Share.share({ message: `Join "${space!.name}" on Huddle: ${link}\nOr enter the code ${space!.invite_code}` });
  }

  const enabled = types.filter((t) => t.enabled);

  return (
    <Screen title={space.name} subtitle={`${members.length} member${members.length === 1 ? '' : 's'} · you are ${myRole ? roleLabel(myRole).toLowerCase() : 'a member'}`}>
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

      <Section title={`Members · ${members.length}`}>
        <Card>
          {members.map((m) => (
            <View key={m.user_id} style={styles.member}>
              <View style={[styles.avatar, { backgroundColor: theme.positive }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
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
            </View>
          ))}
        </Card>
      </Section>

      <Card>
        <ThemedText type="smallBold">Board and admin settings come next</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Streaks, records, the last 21 days and admin settings will live on this page.
        </ThemedText>
      </Card>
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
});
