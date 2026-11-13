import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cleanVals, derive, missingRequired, type ActivityType } from '@/lib/activity';
import { useAuth } from '@/lib/auth';
import { friendlyError, supabase } from '@/lib/supabase';

type Photo = { uri: string; mimeType: string };

export default function LogActivityScreen() {
  const theme = useTheme();
  const { session } = useAuth();
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
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError('Camera access is off. You can turn it on in your phone settings.');
        return;
      }
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) {
      setPhoto({ uri: res.assets[0].uri, mimeType: res.assets[0].mimeType ?? 'image/jpeg' });
    }
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
      const ext = photo.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      photoPath = `${id}/${session.user.id}/${Date.now()}.${ext}`;
      const body = await (await fetch(photo.uri)).arrayBuffer();
      const up = await supabase.storage.from('proofs').upload(photoPath, body, { contentType: photo.mimeType });
      if (up.error) {
        setBusy(false);
        setError(`The photo didn't upload: ${up.error.message}`);
        return;
      }
    }
    const { error: err } = await supabase.rpc('create_checkin', {
      p_space: id,
      p_type: type.id,
      p_vals: vals,
      p_caption: caption.trim() || null,
      p_photo_path: photoPath,
    });
    setBusy(false);
    if (err) setError(friendlyError(err));
    else router.back();
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
