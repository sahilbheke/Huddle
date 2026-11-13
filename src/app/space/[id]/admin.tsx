import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { roleLabel, type Role } from '@/lib/spaces';
import { friendlyError, supabase } from '@/lib/supabase';

type Field = { id: string; label: string; state: 'required' | 'optional' | 'hidden'; is_primary: boolean; sort: number };
type Type = { id: string; label: string; enabled: boolean; sort: number; activity_fields: Field[] };
type Member = { user_id: string; role: Role; profiles: { name: string } | null };
type SpaceRow = {
  owner_id: string;
  rest_days_per_week: number;
  posts_per_hour: number;
  chat_enabled: boolean;
  photos_enabled: boolean;
  show_board: boolean;
  show_heatmap: boolean;
  show_records: boolean;
};

const STATES: Field['state'][] = ['required', 'optional', 'hidden'];
const nextState = (s: Field['state']) => STATES[(STATES.indexOf(s) + 1) % STATES.length];

export default function AdminScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [space, setSpace] = useState<SpaceRow | null>(null);
  const [types, setTypes] = useState<Type[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [error, setError] = useState('');

  // Local copies of the rules so the controls feel instant; saved with the button.
  const [rest, setRest] = useState(2);
  const [perHour, setPerHour] = useState(2);
  const [chat, setChat] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [showBoard, setShowBoard] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRecords, setShowRecords] = useState(true);
  const [savingRules, setSavingRules] = useState(false);

  const load = useCallback(async () => {
    const [s, t, m] = await Promise.all([
      supabase.from('spaces').select('*').eq('id', id).maybeSingle(),
      supabase.from('activity_types').select('id, label, enabled, sort, activity_fields(id, label, state, is_primary, sort)').eq('space_id', id).order('sort'),
      supabase.from('space_members').select('user_id, role, profiles(name)').eq('space_id', id).order('joined_at'),
    ]);
    const sp = s.data as SpaceRow | null;
    const mine = (m.data as Member[] | null)?.find((x) => x.user_id === me)?.role;
    if (!sp || (mine !== 'owner' && mine !== 'admin')) {
      setAllowed(false);
      return;
    }
    setSpace(sp);
    setRest(sp.rest_days_per_week);
    setPerHour(sp.posts_per_hour);
    setChat(sp.chat_enabled);
    setPhotos(sp.photos_enabled);
    setShowBoard(sp.show_board);
    setShowHeatmap(sp.show_heatmap);
    setShowRecords(sp.show_records);
    setTypes(
      ((t.data as Type[] | null) ?? []).map((x) => ({ ...x, activity_fields: [...x.activity_fields].sort((a, b) => a.sort - b.sort) })),
    );
    setMembers((m.data as Member[] | null) ?? []);
  }, [id, me]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!allowed) {
    return (
      <Screen title="Admin & settings">
        <ThemedText themeColor="textSecondary">Only an owner or admin can open settings.</ThemedText>
      </Screen>
    );
  }

  const isOwner = space?.owner_id === me;

  async function saveRules() {
    setSavingRules(true);
    setError('');
    const { error: err } = await supabase.rpc('update_space_rules', {
      p_space: id,
      p_rest: rest,
      p_per_hour: perHour,
      p_chat: chat,
      p_photos: photos,
      p_show_board: showBoard,
      p_show_heatmap: showHeatmap,
      p_show_records: showRecords,
    });
    setSavingRules(false);
    if (err) setError(friendlyError(err));
  }

  async function toggleType(t: Type) {
    setTypes((cur) => cur.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)));
    const { error: err } = await supabase.rpc('set_type_enabled', { p_type: t.id, p_enabled: !t.enabled });
    if (err) {
      setError(friendlyError(err));
      load();
    }
  }

  async function cycleField(typeId: string, f: Field) {
    if (f.is_primary) {
      // The primary field can be required or optional, never hidden.
      const ns = f.state === 'required' ? 'optional' : 'required';
      applyField(typeId, f.id, ns);
      const { error: err } = await supabase.rpc('set_field_state', { p_field: f.id, p_state: ns });
      if (err) {
        setError(friendlyError(err));
        load();
      }
      return;
    }
    const ns = nextState(f.state);
    applyField(typeId, f.id, ns);
    const { error: err } = await supabase.rpc('set_field_state', { p_field: f.id, p_state: ns });
    if (err) {
      setError(friendlyError(err));
      load();
    }
  }

  function applyField(typeId: string, fieldId: string, state: Field['state']) {
    setTypes((cur) =>
      cur.map((t) =>
        t.id === typeId ? { ...t, activity_fields: t.activity_fields.map((f) => (f.id === fieldId ? { ...f, state } : f)) } : t,
      ),
    );
  }

  async function setRole(user: string, role: 'admin' | 'member') {
    setMembers((cur) => cur.map((m) => (m.user_id === user ? { ...m, role } : m)));
    const { error: err } = await supabase.rpc('set_member_role', { p_space: id, p_user: user, p_role: role });
    if (err) {
      setError(friendlyError(err));
      load();
    }
  }

  const stateColour = (s: Field['state']) => (s === 'required' ? theme.accent : s === 'optional' ? theme.textSecondary : theme.border);

  return (
    <Screen title="Admin & settings" subtitle={isOwner ? 'You own this space' : 'You are an admin'}>
      <ErrorText>{error}</ErrorText>

      <Section title="Rules">
        <Card>
          <Stepper label="Rest days per week" value={rest} min={0} max={6} onChange={setRest} />
          <Stepper label="Posts per hour, each person" value={perHour} min={0} max={20} onChange={setPerHour} format={(v) => (v === 0 ? 'Off' : String(v))} />
          <ToggleRow label="Group chat" hint={chat ? 'Members can send messages' : 'Only check-ins can be posted'} value={chat} onValueChange={setChat} />
          <ToggleRow label="Proof photos" hint={photos ? 'Members can attach a photo' : 'No photos on check-ins'} value={photos} onValueChange={setPhotos} />
          <Button label="Save rules" onPress={saveRules} busy={savingRules} />
        </Card>
      </Section>

      <Section title="What members see">
        <Card>
          <ToggleRow label="Board" hint="Streaks and standings" value={showBoard} onValueChange={setShowBoard} />
          <ToggleRow label="Last 21 days" hint="The day-by-day grid" value={showHeatmap} onValueChange={setShowHeatmap} />
          <ToggleRow label="Personal bests" hint="Records for runs, scores and deals" value={showRecords} onValueChange={setShowRecords} />
          <ThemedText type="small" themeColor="textSecondary">
            Remember to tap Save rules above after changing these.
          </ThemedText>
        </Card>
      </Section>

      <Section title="Activities">
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Turn an activity on or off, and tap a field to cycle it required → optional → hidden. The main field can only be required or optional.
        </ThemedText>
        {types.map((t) => (
          <Card key={t.id}>
            <ToggleRow label={t.label} hint={t.enabled ? 'Members can log this' : 'Hidden from the log screen'} value={t.enabled} onValueChange={() => toggleType(t)} />
            <View style={styles.fields}>
              {t.activity_fields.map((f) => (
                <Pressable
                  key={f.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.label}: ${f.state}${f.is_primary ? ', main field' : ''}. Tap to change.`}
                  onPress={() => cycleField(t.id, f)}
                  style={[styles.fieldChip, { borderColor: stateColour(f.state), backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small">
                    {f.label}
                    {f.is_primary ? ' ★' : ''}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: stateColour(f.state) }}>
                    {f.state}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </Card>
        ))}
      </Section>

      {isOwner ? (
        <Section title="Admin access">
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Admins can change these settings. Only you, the owner, can grant or remove admin access.
          </ThemedText>
          <Card>
            {members.map((m) => (
              <View key={m.user_id} style={styles.memberRow}>
                <ThemedText style={styles.grow} numberOfLines={1}>
                  {m.profiles?.name || 'Member'}
                  {m.user_id === me ? ' (you)' : ''}
                </ThemedText>
                {m.role === 'owner' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {roleLabel(m.role)}
                  </ThemedText>
                ) : (
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: m.role === 'admin' }}
                    accessibilityLabel={`${m.profiles?.name || 'Member'} is ${roleLabel(m.role)}. Tap to ${m.role === 'admin' ? 'remove admin' : 'make admin'}.`}
                    onPress={() => setRole(m.user_id, m.role === 'admin' ? 'member' : 'admin')}
                    style={[styles.rolePill, { borderColor: m.role === 'admin' ? theme.accent : theme.border, backgroundColor: m.role === 'admin' ? theme.accentSoft : theme.background }]}>
                    <ThemedText type="small">{m.role === 'admin' ? 'Admin' : 'Make admin'}</ThemedText>
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

function ToggleRow({ label, hint, value, onValueChange }: { label: string; hint: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.grow}>
        <ThemedText>{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} trackColor={{ true: theme.positive }} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: Spacing.one },
  grow: { flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  fieldChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, minHeight: 36 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  rolePill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, minHeight: 36, justifyContent: 'center' },
});
