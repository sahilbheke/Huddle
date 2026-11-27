import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = { uri?: string; label: string };

/**
 * A photo in the feed. Tapping opens it full screen; the round button drawn on the
 * photo is the download button, which for now only says the photo is unavailable.
 */
export function FeedPhoto({ uri, label }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (!uri) return <View style={[styles.photo, { backgroundColor: theme.backgroundSelected }]} />;
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${label}, open full screen`} onPress={() => setOpen(true)}>
        <Image source={{ uri }} style={styles.photo} contentFit="cover" accessibilityLabel={label} transition={150} />
        <DownloadOverlay />
      </Pressable>
      <Modal visible={open} animationType="fade" transparent={false} onRequestClose={() => setOpen(false)}>
        <View style={styles.viewer}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel={label} />
          <SafeAreaView style={styles.viewerTop} edges={['top']}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setOpen(false)} hitSlop={12} style={styles.roundBtn}>
              <ThemedText style={styles.glyph}>✕</ThemedText>
            </Pressable>
          </SafeAreaView>
          <DownloadOverlay large />
        </View>
      </Modal>
    </>
  );
}

/** Download button over the photo's corner. Downloads aren't built yet, so it shows a short notice. */
function DownloadOverlay({ large }: { large?: boolean }) {
  const [notice, setNotice] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function press() {
    setNotice(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(false), 2000);
  }

  return (
    <>
      {notice ? (
        <View style={styles.noticeWrap} pointerEvents="none">
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <ThemedText type="smallBold" style={styles.light}>
              Photo Unavailable
            </ThemedText>
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Download photo"
        onPress={press}
        hitSlop={8}
        style={[styles.roundBtn, styles.download, large && styles.downloadLarge]}>
        <ThemedText style={styles.glyph}>⤓</ThemedText>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10 },
  light: { color: '#fff' },
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
  noticeWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  notice: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'flex-end', padding: 16 },
});
