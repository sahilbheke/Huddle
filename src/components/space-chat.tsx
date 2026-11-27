import { useEffect, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { colorForUser } from '@/lib/activity';

/** One member's numbers for today, from space_board. */
export type PulseMember = { user_id: string; name: string; streak: number; done_today: boolean };

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Saee", "Saee and Rohan", "Saee, Rohan and 2 others". */
export function joinNames(names: string[]): string {
  const first = names.map(firstName);
  if (first.length <= 2) return first.join(' and ');
  if (first.length === 3) return `${first[0]}, ${first[1]} and ${first[2]}`;
  return `${first[0]}, ${first[1]} and ${first.length - 2} others`;
}

export function Avatar({ userId, name, size = 28, style }: { userId: string; name: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorForUser(userId) }, styles.avatar, style]}>
      <ThemedText style={[styles.avatarText, { fontSize: size * 0.42, lineHeight: size * 0.56 }]}>{initial(name)}</ThemedText>
    </View>
  );
}

/**
 * The strip under the header: a ring per member that fills in once they've logged today.
 * Seeing faces light up is what makes "2 of 4" feel like a team rather than a score.
 */
export function TeamPulse({ members, me }: { members: PulseMember[]; me?: string }) {
  const theme = useTheme();
  const done = members.filter((m) => m.done_today).length;
  const all = members.length > 0 && done === members.length;
  // You first, then whoever has logged, then the rest.
  const order = [...members].sort(
    (a, b) => Number(b.user_id === me) - Number(a.user_id === me) || Number(b.done_today) - Number(a.done_today),
  );
  return (
    <View style={[styles.pulse, { borderBottomColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.grow} contentContainerStyle={styles.rings}>
        {order.map((m) => {
          const mine = m.user_id === me;
          return (
            <View
              key={m.user_id}
              accessible
              accessibilityLabel={`${mine ? 'You' : m.name}: ${m.done_today ? 'logged today' : 'not logged yet'}`}
              style={[
                styles.ring,
                { borderColor: m.done_today ? theme.positive : mine ? theme.accent : theme.border },
                !m.done_today && mine && styles.dashed,
              ]}>
              <Avatar userId={m.user_id} name={m.name} size={30} />
              {m.done_today ? (
                <View style={[styles.tick, { backgroundColor: theme.positive, borderColor: theme.background }]}>
                  <ThemedText style={[styles.tickText, { color: theme.background }]}>✓</ThemedText>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.pulseText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {all ? 'Everyone is in' : `${done} of ${members.length} in today`}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.pulseSub} numberOfLines={1}>
          {all ? 'Perfect day 🎉' : 'Rings fill as people log'}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * The line above the composer. Before you log it names who already showed up and the
 * streak you'd lose; after, it points you at whoever is still missing.
 */
export function Nudge({ members, me, onLog, onDismiss }: { members: PulseMember[]; me?: string; onLog: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  const mine = members.find((m) => m.user_id === me);
  if (!mine) return null;
  const others = members.filter((m) => m.user_id !== me);
  const doneOthers = others.filter((m) => m.done_today);
  const missing = others.filter((m) => !m.done_today);

  if (!mine.done_today) {
    const streak = mine.streak;
    const lead = doneOthers.length ? `${joinNames(doneOthers.map((m) => m.name))} showed up.` : 'Nobody has logged yet today.';
    const tail = streak > 0 ? `Log today to keep your ${streak}-day streak.` : doneOthers.length ? 'Log today to join them.' : 'Be the first and set the pace.';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${lead} ${tail}`}
        onPress={onLog}
        style={[styles.nudge, { backgroundColor: theme.accentSoft }]}>
        {doneOthers.length ? (
          <View style={styles.stack}>
            {doneOthers.slice(0, 3).map((m, i) => (
              <Avatar key={m.user_id} userId={m.user_id} name={m.name} size={24} style={[styles.stacked, { borderColor: theme.accentSoft }, i === 0 && styles.firstStacked]} />
            ))}
          </View>
        ) : (
          <ThemedText style={styles.nudgeIcon}>🔥</ThemedText>
        )}
        <ThemedText type="small" style={styles.grow}>
          <ThemedText type="smallBold">{lead}</ThemedText> {tail}
        </ThemedText>
      </Pressable>
    );
  }

  const text = missing.length
    ? `${joinNames(missing.map((m) => m.name))} ${missing.length === 1 ? "hasn't" : "haven't"} logged yet. A cheer might help.`
    : 'Everyone showed up today.';
  return (
    <View style={[styles.nudge, { backgroundColor: theme.positiveSoft }]}>
      <ThemedText type="small" style={styles.grow}>
        <ThemedText type="smallBold">{missing.length ? `You're in. Day ${mine.streak} 🔥` : '🎉 Perfect day.'}</ThemedText> {text}
      </ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Hide" onPress={onDismiss} hitSlop={12}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ✕
        </ThemedText>
      </Pressable>
    </View>
  );
}

export function DaySeparator({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.day, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.dayText}>
        {label}
      </ThemedText>
    </View>
  );
}

/** "Today", "Yesterday", "Wed, Nov 25", or with the year when it isn't this year. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A short "Day 7 🔥" moment that pops in over the feed when you've just logged. */
export function Celebration({ title, body, onDone }: { title: string; body: string; onDone: () => void }) {
  const theme = useTheme();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.spring(v, { toValue: 1, useNativeDriver: true, friction: 6 }),
      Animated.delay(1800),
      Animated.timing(v, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && onDone());
    return () => anim.stop();
  }, [v, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.celebrate,
        { backgroundColor: theme.text, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
      ]}>
      <ThemedText style={[styles.celebrateTitle, { color: theme.background }]}>{title}</ThemedText>
      <ThemedText type="smallBold" style={[styles.center, { color: theme.background }]}>
        {body}
      </ThemedText>
    </Animated.View>
  );
}

/** A pill that bounces when pressed, for cheering. */
export function CheerButton({ count, cheered, onPress, label }: { count: number; cheered: boolean; onPress: () => void; label: boolean }) {
  const theme = useTheme();
  const [scale] = useState(() => new Animated.Value(1));
  function press() {
    scale.setValue(0.8);
    Animated.spring(scale, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }).start();
    onPress();
  }
  const text = label ? `👏 ${count > 0 ? `${count} · ` : ''}${cheered ? 'Cheered' : 'Cheer'}` : `👏 ${count || ''}`;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cheered ? `Remove cheer, ${count} cheers` : `Cheer, ${count} cheers`}
        accessibilityState={{ selected: cheered }}
        onPress={press}
        hitSlop={8}
        style={[
          styles.cheer,
          { borderColor: cheered ? theme.accent : theme.border, backgroundColor: cheered ? theme.accentSoft : theme.background },
        ]}>
        <ThemedText type="small" style={[styles.cheerText, cheered && { color: theme.accent, fontWeight: '700' }]}>
          {text}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  pulse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingRight: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rings: { gap: Spacing.two, paddingLeft: Spacing.three, paddingRight: Spacing.one, alignItems: 'center' },
  ring: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  dashed: { borderStyle: 'dashed' },
  tick: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickText: { fontSize: 10, lineHeight: 12, fontWeight: '700' },
  pulseText: { alignItems: 'flex-end', maxWidth: '45%' },
  pulseSub: { fontSize: 12, lineHeight: 16 },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 16,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
  },
  nudgeIcon: { fontSize: 20, lineHeight: 26 },
  stack: { flexDirection: 'row' },
  stacked: { borderWidth: 2, marginLeft: -8 },
  firstStacked: { marginLeft: 0 },
  day: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 2, marginVertical: Spacing.two },
  dayText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  celebrate: {
    position: 'absolute',
    alignSelf: 'center',
    top: '35%',
    borderRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: 2,
    maxWidth: '85%',
  },
  celebrateTitle: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
  cheer: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, minHeight: 30, justifyContent: 'center' },
  cheerText: { fontSize: 13, lineHeight: 18 },
});
