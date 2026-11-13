import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TEMPLATES, type Template } from '@/lib/spaces';
import { friendlyError, supabase } from '@/lib/supabase';

export default function NewSpaceScreen() {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<Template>('fitness');
  const [rest, setRest] = useState(2);
  const [perHour, setPerHour] = useState(2);
  const [chat, setChat] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!name.trim()) {
      setError('Give the space a name.');
      return;
    }
    setError('');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('create_space', {
      p_name: name.trim(),
      p_template: template,
      p_rest: rest,
      p_per_hour: perHour,
      p_chat: chat,
    });
    setBusy(false);
    if (err) setError(friendlyError(err));
    else router.replace({ pathname: '/space/[id]', params: { id: data as string } });
  }

  return (
    <Screen title="New space" subtitle="Pick a type, set the rules, then invite people">
      <View style={styles.field}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Morning runners" maxLength={80} autoFocus />
      </View>

      <Section title="Start from">
        {TEMPLATES.map((t) => {
          const on = t.key === template;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setTemplate(t.key)}
              style={[
                styles.option,
                { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accentSoft : theme.backgroundElement },
              ]}>
              <ThemedText type="smallBold" style={styles.optionTitle}>
                {t.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t.blurb}
              </ThemedText>
            </Pressable>
          );
        })}
        <ThemedText type="small" themeColor="textSecondary">
          You can switch activity types on or off and choose required fields later in Admin & settings.
        </ThemedText>
      </Section>

      <Section title="Rules">
        <Card>
          <Stepper label="Rest days per week" value={rest} min={0} max={6} onChange={setRest} />
          <Stepper
            label="Posts per hour, each person"
            value={perHour}
            min={0}
            max={20}
            onChange={setPerHour}
            format={(v) => (v === 0 ? 'Off' : String(v))}
          />
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <ThemedText>Group chat</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {chat ? 'Members can send normal messages' : 'Only check-ins can be posted'}
              </ThemedText>
            </View>
            <Switch value={chat} onValueChange={setChat} accessibilityLabel="Group chat" trackColor={{ true: theme.positive }} />
          </View>
        </Card>
      </Section>

      <ErrorText>{error}</ErrorText>
      <Button label="Create space" onPress={create} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  option: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.half },
  optionTitle: { fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
