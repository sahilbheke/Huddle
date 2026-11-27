import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cleanVals, derive, missingRequired, summarize, type ActivityType } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { notifySpace } from '@/lib/notifications';
import { pickPhoto, removePhotos, uploadPhoto, type Photo } from '@/lib/photos';
import { friendlyError, supabase } from '@/lib/supabase';

export default function LogActivityScreen() {
  const theme = useTheme();
  const { session, profile } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [photosOn, setPhotosOn] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [caption, setCaption] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      supabase
        .from('activity_types')
        .select('id, key, label, derive_kind, activity_fields(key, label, unit, kind, state, sort)')
        .eq('space_id', id)
        .eq('enabled', true)
        .order('sort'),
      supabase.from('spaces').select('photos_enabled').eq('id', id).single(),
    ]).then(([t, s]) => {
      const list = ((t.data as ActivityType[] | null) ?? []).map((x) => ({
        ...x,
        activity_fields: [...x.activity_fields].sort((a, b) => a.sort - b.sort),
      }));
      setTypes(list);
      setTypeId((cur) => cur ?? list[0]?.id ?? null);
      setPhotosOn(!!s.data?.photos_enabled);
    });
  }, [id]);

  const type = types.find((t) => t.id === typeId);
  const fields = useMemo(() => (type?.activity_fields ?? []).filter((f) => f.state !== 'hidden'), [type]);
  const vals = cleanVals(fields, form);
  const derived = derive(type?.derive_kind, vals);

  function pickType(next: string) {
    setTypeId(next);
    setForm({});
    setError('');
  }

  async function pick(source: 'camera' | 'library') {
    const res = await pickPhoto(source);
    if (!res) return;
    if ('error' in res) setError(res.error);
    else setPhoto(res.photo);
  }

  async function submit() {
    if (!type || !session) return;
    const missing = missingRequired(fields, vals);
    if (missing.length) {
      setError(`Add ${missing.join(' and ').toLowerCase()} to log ${type.label.toLowerCase()}.`);
      return;
    }
    setError('');
    setBusy(true);
    let photoPath: string | null = null;
    if (photo) {
      const up = await uploadPhoto(id, session.user.id, photo);
      if ('error' in up) {
        setBusy(false);
        setError(up.error);
        return;
      }
      photoPath = up.path;
    }
    const { error: err } = await supabase.rpc('create_checkin', {
      p_space: id,
      p_type: type.id,
      p_vals: vals,
      p_caption: caption.trim() || null,
      p_photo_path: photoPath,
    });
    setBusy(false);
    if (err) {
      // The check-in wasn't saved, so don't leave its photo behind in storage.
      removePhotos([photoPath]);
      setError(friendlyError(err));
    } else {
      const who = profile?.name || 'Someone';
      const what = summarize(fields, vals);
      notifySpace(id, 'New check-in', `${who} logged ${type.label.toLowerCase()}${what ? ` — ${what}` : ''}`);
      router.back();
    }
  }

  return (
    <Screen title="Log activity" subtitle="Fields marked * are required in this space">
      <Section title="Activity">
        <View style={styles.chips}>
          {types.map((t) => {
            const on = t.id === typeId;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => pickType(t.id)}
                style={[
                  styles.chip,
                  { borderColor: on ? theme.accent : theme.border, backgroundColor: on ? theme.accentSoft : theme.backgroundElement },
                ]}>
                <ThemedText type="smallBold">{t.label}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {type ? (
        <Section title="Details">
          {fields.map((f) => (
            <View key={f.key} style={styles.field}>
              <Field
                label={`${f.label}${f.unit ? ` (${f.unit})` : ''}${f.state === 'required' ? ' *' : ''}`}
                value={form[f.key] ?? ''}
                onChangeText={(v) => setForm((cur) => ({ ...cur, [f.key]: v }))}
                keyboardType={f.kind === 'number' ? 'decimal-pad' : 'default'}
                placeholder={f.state === 'required' ? 'Required' : 'Optional'}
              />
            </View>
          ))}
          {derived ? (
            <Card>
              <ThemedText type="small" themeColor="textSecondary">
                Worked out from your numbers
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.positive, fontSize: 18 }}>
                {derived}
              </ThemedText>
            </Card>
          ) : null}
          <View style={styles.field}>
            <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="How did it go?" maxLength={500} multiline />
          </View>
        </Section>
      ) : null}

      {type && photosOn ? (
        <Section title="Proof photo (optional)">
          {photo ? (
            <View style={styles.field}>
              <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="cover" accessibilityLabel="Selected proof photo" />
              <Button label="Remove photo" kind="secondary" onPress={() => setPhoto(null)} />
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Button label="Take photo" kind="secondary" onPress={() => pick('camera')} />
              </View>
              <View style={styles.grow}>
                <Button label="Choose photo" kind="secondary" onPress={() => pick('library')} />
              </View>
            </View>
          )}
        </Section>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button label="Post check-in" onPress={submit} busy={busy} disabled={!type} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, minHeight: 44, justifyContent: 'center' },
  field: { gap: Spacing.two },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  row: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
});
