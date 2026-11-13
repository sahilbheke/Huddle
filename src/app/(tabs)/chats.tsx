import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function ChatsScreen() {
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={['top']}>
        <View style={styles.body}>
          <ThemedText type="subtitle">Chats</ThemedText>
          <ThemedView type="backgroundElement" style={styles.empty}>
            <ThemedText type="smallBold">No chats yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Direct messages with people from your spaces will show here.
            </ThemedText>
          </ThemedView>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  empty: { borderRadius: 14, padding: Spacing.four, gap: Spacing.one },
});
