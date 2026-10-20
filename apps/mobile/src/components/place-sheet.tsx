import type { PlaceResult, TripLocation } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DateRange } from '@/lib/dates';
import { formatDateRange } from '@/lib/format';
import { colors, fonts, radius, space } from '@/theme';
import { DateRangeField } from './date-range-picker';
import { DestinationField } from './destination-field';
import { Body, Button } from './ui';

/** A place as the trip forms edit it, before or after it's saved. */
export interface DraftPlace {
  destination: string;
  location: TripLocation | null;
  startDate: string | null;
  endDate: string | null;
}

export const locationOf = (place: PlaceResult): TripLocation => ({
  placeId: place.id,
  latitude: place.latitude,
  longitude: place.longitude,
  bounds: place.bounds,
  countryCode: place.countryCode,
});

interface Props {
  visible: boolean;
  /** "Add a stop" or "Edit Porto". */
  title: string;
  initial: DraftPlace | null;
  /** The trip's dates: a place's own dates sit inside them, and need them set first. */
  tripDates: DateRange;
  /** Saves it; resolves to a problem to show, or null when done. */
  onSave: (place: DraftPlace) => Promise<string | null>;
  /** Offered when the place can go (not the trip's only one). */
  onRemove?: () => Promise<string | null>;
  onClose: () => void;
}

const empty: DraftPlace = { destination: '', location: null, startDate: null, endDate: null };

/** One place on a trip: which city, and optionally the days spent there. */
export function PlaceSheet({ visible, title, initial, tripDates, onSave, onRemove, onClose }: Props) {
  const [draft, setDraft] = useState<DraftPlace>(initial ?? empty);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(initial ?? empty);
    setProblem(undefined);
    // Fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    const result = await work().catch(() => 'That didn’t work. Try again.');
    setBusy(false);
    if (result) setProblem(result);
    else onClose();
  };

  const save = () => {
    if (!draft.destination.trim()) return setProblem('Where is it?');
    void run(() => onSave({ ...draft, destination: draft.destination.trim() }));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <DestinationField
              value={draft.destination}
              picked={!!draft.location}
              onChangeText={(text) => setDraft((d) => ({ ...d, destination: text, location: null }))}
              onPick={(place) => setDraft((d) => ({ ...d, destination: place.label, location: locationOf(place) }))}
              autoFocus={!initial}
            />
            {tripDates.start ? (
              <>
                <DateRangeField
                  label="Days there (optional)"
                  value={{ start: draft.startDate, end: draft.endDate }}
                  onChange={(r) => setDraft((d) => ({ ...d, startDate: r.start, endDate: r.end }))}
                />
                <Body style={{ fontSize: 12 }}>
                  Within the trip ({formatDateRange(tripDates.start, tripDates.end)}). Places can share the travel day,
                  when one ends and the next begins. Each day’s weather, map and times follow its place.
                </Body>
                {draft.startDate ? (
                  <Button
                    label="Clear the days"
                    variant="ghost"
                    onPress={() => setDraft((d) => ({ ...d, startDate: null, endDate: null }))}
                    style={{ alignSelf: 'flex-start', minHeight: 36 }}
                  />
                ) : null}
              </>
            ) : (
              <Body style={{ fontSize: 12 }}>Once the trip has dates, you can say which days you’re in each place.</Body>
            )}
            {problem ? (
              <Body style={{ color: colors.coralInk }} accessibilityLiveRegion="polite">
                {problem}
              </Body>
            ) : null}
            <Button label="Save" onPress={save} loading={busy} />
            {onRemove ? (
              <Button label="Remove from the trip" variant="outline" onPress={() => void run(onRemove)} disabled={busy} />
            ) : null}
            <Button label="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { maxHeight: '90%', backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
});
