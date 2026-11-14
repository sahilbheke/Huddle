import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Screen, Section } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type BoardRow = {
  user_id: string;
  name: string;
  role: string;
  streak: number;
  best_streak: number;
  kept_pct: number;
  rest_used_week: number;
  done_today: boolean;
};
type GridRow = { user_id: string; name: string; day: string; status: string };
type RecordRow = {
  kind: string;
  type_label: string | null;
  record_kind: string | null;
  value: number;
  user_id: string;
  name: string;
};

/** A personal best shown as a readable value. */
function formatRecord(r: RecordRow): string {
  if (r.record_kind === 'fastest_5k') {
    const s = Math.round(r.value);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} for 5K`;
  }
  if (r.record_kind === 'top_score') return `${r.value} top score`;
  if (r.record_kind === 'biggest_deal') return `biggest deal ${r.value}`;
  return `${r.value}${r.type_label ? ` best ${r.type_label.toLowerCase()}` : ''}`;
}

export default function BoardScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);

  const load = useCallback(async () => {
    const [b, g, r] = await Promise.all([
      supabase.rpc('space_board', { p_space: id }),
      supabase.rpc('space_grid', { p_space: id, p_days: 21 }),
      supabase.rpc('space_records', { p_space: id }),
    ]);
    const rows = ((b.data as BoardRow[] | null) ?? []).sort(
      (a, z) => z.streak - a.streak || z.kept_pct - a.kept_pct || a.name.localeCompare(z.name),
    );
    setBoard(rows);
    setGrid((g.data as GridRow[] | null) ?? []);
    setRecords((r.data as RecordRow[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Group the grid rows by member, in the board's ranked order.
  const gridByUser = useMemo(() => {
    const map = new Map<string, GridRow[]>();
    for (const row of grid) {
      const list = map.get(row.user_id) ?? [];
      list.push(row);
      map.set(row.user_id, list);
    }
    return map;
  }, [grid]);

  const colour = (status: string) => {
    switch (status) {
      case 'done':
        return theme.positive;
      case 'rest':
        return theme.accentSoft;
      case 'missed':
        return theme.danger;
      case 'today':
        return theme.border;
      default:
        return theme.backgroundSelected;
    }
  };

  return (
    <Screen title="Board" subtitle="Ranked by current streak">
      <Section title="Standings">
        <Card>
          {board.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No activity yet. Log a check-in to start the board.
            </ThemedText>
          ) : (
            board.map((row, i) => (
              <View key={row.user_id} style={styles.row}>
                <ThemedText type="smallBold" style={styles.rank}>
                  {i + 1}
                </ThemedText>
                <View style={styles.grow}>
                  <ThemedText type="smallBold">
                    {row.name}
                    {row.user_id === me ? ' (you)' : ''}
                    {row.done_today ? ' ✅' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {row.kept_pct}% kept · best streak {row.best_streak}
                  </ThemedText>
                </View>
                <View style={styles.streak}>
                  <ThemedText type="smallBold" style={{ color: theme.accent, fontSize: 20 }}>
                    {row.streak}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    day{row.streak === 1 ? '' : 's'}
                  </ThemedText>
                </View>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Last 21 days">
        <Card>
          <View style={styles.legend}>
            {[
              ['Done', theme.positive],
              ['Rest', theme.accentSoft],
              ['Missed', theme.danger],
            ].map(([label, c]) => (
              <View key={label as string} style={styles.legendItem}>
                <View style={[styles.cell, { backgroundColor: c as string }]} />
                <ThemedText type="small" themeColor="textSecondary">
                  {label}
                </ThemedText>
              </View>
            ))}
          </View>
          {board.map((row) => (
            <View key={row.user_id} style={styles.gridRow}>
              <ThemedText type="small" numberOfLines={1} style={styles.gridName}>
                {row.name}
              </ThemedText>
              <View style={styles.cells}>
                {(gridByUser.get(row.user_id) ?? []).map((d) => (
                  <View
                    key={d.day}
                    style={[styles.cell, { backgroundColor: colour(d.status), borderColor: theme.border }, d.status === 'today' && styles.today]}
                    accessibilityLabel={`${d.day}: ${d.status}`}
                  />
                ))}
              </View>
            </View>
          ))}
        </Card>
      </Section>

      <Section title="Personal bests">
        <Card>
          {records.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No records yet. They appear as people log their first runs, scores and deals.
            </ThemedText>
          ) : (
            records.map((r) => (
              <View key={r.kind} style={styles.row}>
                <ThemedText type="smallBold">🏆</ThemedText>
                <View style={styles.grow}>
                  <ThemedText type="smallBold">{formatRecord(r)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {r.name}
                    {r.user_id === me ? ' (you)' : ''}
                  </ThemedText>
                </View>
              </View>
            ))
          )}
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  rank: { width: 20, textAlign: 'center' },
  grow: { flex: 1 },
  streak: { alignItems: 'center', minWidth: 48 },
  legend: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  gridName: { width: 70 },
  cells: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  cell: { width: 12, height: 12, borderRadius: 3 },
  today: { borderWidth: 1 },
});
