import Feather from '@expo/vector-icons/Feather';
import {
  IdeaList,
  ItemList,
  RecommendationList,
  suggestPacking,
  TripWeather,
  type PackingSuggestion,
  type Trip,
} from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { request } from '@/lib/api';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button } from './ui';

interface Props {
  visible: boolean;
  trip: Trip;
  /** What's on the packing list already, so it isn't suggested again. */
  existing: string[];
  onAdd: (picked: PackingSuggestion[]) => Promise<void>;
  onClose: () => void;
}

/**
 * "Start with suggestions": a starter packing list from the trip's weather and
 * the kinds of places nearby (simple rules, no AI). Everything starts ticked;
 * untick what you don't want.
 */
export function PackingSuggestions({ visible, trip, existing, onAdd, onClose }: Props) {
  const [suggestions, setSuggestions] = useState<PackingSuggestion[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setSuggestions(null);
    setSkipped(new Set());
    const quiet = <T,>(p: Promise<T>) => p.catch(() => null);
    void Promise.all([
      quiet(request(`/trips/${trip.id}/weather`, { schema: TripWeather })),
      trip.location ? quiet(request(`/trips/${trip.id}/recommendations?category=nature`, { schema: RecommendationList })) : null,
      quiet(request(`/trips/${trip.id}/ideas`, { schema: IdeaList })),
      quiet(request(`/trips/${trip.id}/items`, { schema: ItemList })),
    ]).then(([weather, nature, ideas, plan]) => {
      if (!live) return;
      const places = [
        ...(nature?.places ?? []).flatMap((p) => [p.kind ?? '', p.name]),
        ...(ideas?.ideas ?? []).map((i) => i.title),
        ...(plan?.items ?? []).flatMap((i) => [i.title, i.placeName ?? '']),
        trip.destination,
      ].filter(Boolean);
      setSuggestions(suggestPacking({ weather: weather?.days ?? [], places }, existing));
    });
    return () => {
      live = false;
    };
    // Only when it opens: the list mustn't reshuffle while someone is choosing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, trip.id]);

  const picked = (suggestions ?? []).filter((s) => !skipped.has(s.text));
  const toggle = (text: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });

  const add = async () => {
    setBusy(true);
    await onAdd(picked);
    setBusy(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <Text accessibilityRole="header" style={styles.title}>
          Start with suggestions
        </Text>
        <Body style={{ fontSize: 13 }}>
          Picked from the weather and the places on this trip. Untick anything you don’t need. “Each person” means
          everyone ticks their own.
        </Body>
        {!suggestions ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: space.xs }}>
            {suggestions.map((s) => {
              const on = !skipped.has(s.text);
              return (
                <Pressable
                  key={s.text}
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  onPress={() => toggle(s.text)}
                  style={styles.row}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.text}>{s.text}</Text>
                    <Text style={styles.reason}>
                      {s.scope === 'everyone' ? 'Each person · ' : 'One for the group · '}
                      {s.reason}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Button
          label={picked.length === 1 ? 'Add 1 thing' : `Add ${picked.length} things`}
          onPress={() => void add()}
          loading={busy}
          disabled={!suggestions || picked.length === 0}
        />
        <Button label="Not now" variant="outline" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  center: { paddingVertical: space.xxl, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.surface },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  reason: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
