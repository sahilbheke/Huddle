import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { downloadPhoto } from '@/lib/photos';

/** uri: the photo's URL, null when the file was deleted from storage, undefined while loading. */
type Props = { uri?: string | null; label: string };

const UNAVAILABLE = 'Photo Unavailable';

/**
 * A photo in the feed. Tapping opens it full screen; the round button on the photo
 * saves it to the phone. A photo whose file was deleted shows "Photo Unavailable".
 */
export function FeedPhoto({ uri, label }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const gone = uri === null || broken;

  if (uri === undefined && !broken) return <View style={[styles.photo, { backgroundColor: theme.backgroundSelected }]} />;
  if (gone || !uri) {
    return (
      <View style={[styles.photo, styles.center, { backgroundColor: theme.backgroundSelected }]} accessibilityLabel={`${label}: ${UNAVAILABLE}`}>
        <ThemedText style={styles.goneIcon}>🖼️</ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {UNAVAILABLE}
        </ThemedText>
      </View>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${label}, open full screen`} onPress={() => setOpen(true)}>
        <Image
          source={{ uri }}
          style={styles.photo}
          contentFit="cover"
          accessibilityLabel={label}
          transition={150}
          onError={() => {
            // Only call it gone if storage says so; a flaky connection just leaves the gray box.
            fetch(uri, { method: 'HEAD' })
              .then((r) => (r.status === 400 || r.status === 404) && setBroken(true))
              .catch(() => {});
          }}
        />
        <DownloadOverlay uri={uri} onGone={() => setBroken(true)} />
      </Pressable>
      <Modal visible={open} animationType="fade" transparent={false} onRequestClose={() => setOpen(false)}>
        <View style={styles.viewer}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={label} />
          <SafeAreaView style={styles.viewerTop} edges={['top']}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setOpen(false)} hitSlop={12} style={styles.roundBtn}>
              <ThemedText style={styles.glyph}>✕</ThemedText>
            </Pressable>
          </SafeAreaView>
          <DownloadOverlay
            uri={uri}
            large
            onGone={() => {
              setOpen(false);
              setBroken(true);
            }}
          />
        </View>
      </Modal>
    </>
  );
}

/** Download button over the photo's corner, with a short notice in the middle of the photo. */
function DownloadOverlay({ uri, large, onGone }: { uri: string; large?: boolean; onGone: () => void }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function show(text: string, after?: () => void) {
    setNotice(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotice('');
      after?.();
    }, 2000);
  }

  async function press() {
    if (busy) return;
    setBusy(true);
    const res = await downloadPhoto(uri);
    setBusy(false);
    if (res === 'saved') show('Saved to your photos');
    else if (res === 'unavailable') show(UNAVAILABLE, onGone);
    else if (typeof res === 'object') show(res.error);
  }

  return (
    <>
      {notice ? (
        <View style={styles.noticeWrap} pointerEvents="none">
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <ThemedText type="smallBold" style={styles.light}>
              {notice}
            </ThemedText>
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Download photo"
        accessibilityState={{ busy }}
        onPress={press}
        hitSlop={8}
        style={[styles.roundBtn, styles.download, large && styles.downloadLarge]}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText style={styles.glyph}>⤓</ThemedText>}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  goneIcon: { fontSize: 28, lineHeight: 34, opacity: 0.6 },
  light: { color: '#fff', textAlign: 'center' },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: '#fff', fontSize: 18, lineHeight: 22, fontWeight: '700' },
  download: { position: 'absolute', right: 8, bottom: 8 },
  downloadLarge: { right: 20, bottom: 48, width: 48, height: 48, borderRadius: 24 },
  noticeWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 16 },
  notice: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
});
