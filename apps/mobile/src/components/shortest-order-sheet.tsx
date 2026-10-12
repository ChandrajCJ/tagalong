import Feather from '@expo/vector-icons/Feather';
import { DayItems, DayOptimisation, ItineraryItem, type TravelMode } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, request } from '@/lib/api';
import { formatDuration, MODE_META } from '@/lib/routes';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button } from './ui';

/** Less than this isn't worth reshuffling anyone's day for. */
const WORTH_IT_S = 120;

interface Props {
  visible: boolean;
  tripId: string;
  date: string;
  mode: TravelMode;
  /** The day's items in their current order. */
  items: ItineraryItem[];
  /** The saved order, or the day as it is now if someone changed it first. */
  onSaved: (items: ItineraryItem[], note?: string) => void;
  onClose: () => void;
}

/**
 * "Shortest order": shows the day now and reordered side by side, and how
 * much travel it saves. Nothing changes until someone taps Apply.
 */
export function ShortestOrderSheet({ visible, tripId, date, mode, items, onSaved, onClose }: Props) {
  const [suggestion, setSuggestion] = useState<DayOptimisation | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSuggestion(null);
    setError(undefined);
    let live = true;
    request(`/trips/${tripId}/days/${date}/optimise?mode=${mode}`, { schema: DayOptimisation })
      .then((s) => live && setSuggestion(s))
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e.message : 'Could not work out a shorter order'));
    return () => {
      live = false;
    };
    // Worked out once per opening, for the order as it was then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const byId = new Map(items.map((i) => [i.id, i]));
  const after = (suggestion?.itemIds ?? []).map((id) => byId.get(id)).filter((i): i is ItineraryItem => !!i);
  const worthIt = !!suggestion && suggestion.savedS >= WORTH_IT_S && after.length === items.length;

  const apply = async () => {
    if (!suggestion) return;
    setBusy(true);
    try {
      const saved = await request(`/trips/${tripId}/days/${date}/order`, {
        method: 'POST',
        body: { itemIds: suggestion.itemIds, versions: Object.fromEntries(items.map((i) => [i.id, i.version])) },
        schema: DayItems,
      });
      onSaved(saved.items);
      onClose();
    } catch (e) {
      const current = e instanceof ApiError && e.status === 409 && ItineraryItem.array().safeParse(e.data.current);
      if (current && current.success) {
        onSaved(current.data, 'Someone changed this day first. Showing the latest order.');
        onClose();
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not save the new order');
      }
    } finally {
      setBusy(false);
    }
  };

  const column = (title: string, list: ItineraryItem[], highlight: boolean) => (
    <View style={styles.column}>
      <Text style={styles.columnTitle}>{title}</Text>
      {list.map((item, n) => {
        const moved = highlight && items[n]?.id !== item.id;
        return (
          <View key={item.id} style={[styles.stop, moved && styles.stopMoved]}>
            <Text style={[styles.stopNumber, moved && { color: colors.accent }]}>{n + 1}</Text>
            <Text style={styles.stopTitle} numberOfLines={2}>
              {item.startTime ? `${item.startTime} ` : ''}
              {item.title}
            </Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Shortest order
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Feather name="x" size={22} color={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {error ? (
            <Body>{error}</Body>
          ) : !suggestion ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Body>Working out the shortest way round…</Body>
            </View>
          ) : !worthIt ? (
            <View style={{ gap: space.sm }}>
              <Feather name="check-circle" size={28} color={colors.accent} />
              <Text style={styles.headline}>This order is already about as short as it gets.</Text>
              <Body>Reordering would save less than two minutes {MODE_META[mode].by}.</Body>
            </View>
          ) : (
            <>
              <View style={{ gap: 4 }}>
                <Text style={styles.headline}>Saves about {formatDuration(suggestion.savedS)}</Text>
                <Body style={{ fontSize: 13 }}>
                  {MODE_META[mode].emoji} About {formatDuration(suggestion.afterS)} of {MODE_META[mode].doing} instead of{' '}
                  {formatDuration(suggestion.beforeS)}. The first stop, anything at a set time and anything not on the map stay where
                  they are.
                </Body>
                {suggestion.estimated ? (
                  <Body style={{ fontSize: 12 }}>The route server didn’t answer, so these times are rough guesses.</Body>
                ) : null}
              </View>
              <View style={styles.columns}>
                {column('Now', items, false)}
                {column('Suggested', after, true)}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {worthIt && !error ? (
            <>
              <Button label="Keep mine" variant="outline" onPress={onClose} style={{ flex: 1 }} />
              <Button label="Apply" onPress={apply} loading={busy} style={{ flex: 1 }} />
            </>
          ) : (
            <Button label="Close" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.lg },
  loading: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  headline: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  columns: { flexDirection: 'row', gap: space.md },
  column: { flex: 1, gap: space.sm },
  columnTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  stop: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  stopMoved: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  stopNumber: { width: 16, fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  stopTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
