import { cityOf, CreateTripInput, currencyForCountry, newId, placeDatesProblem, Trip, type PlaceResult, type TripLocation } from '@tagalong/shared';
import Feather from '@expo/vector-icons/Feather';
import type { ImagePickerAsset } from 'expo-image-picker';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoverImage } from '@/components/cover-image';
import { pickCoverPhoto, uploadCover } from '@/components/cover-photo-picker';
import { DateRangeField } from '@/components/date-range-picker';
import { DestinationField } from '@/components/destination-field';
import { locationOf, PlaceSheet, type DraftPlace } from '@/components/place-sheet';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import type { DateRange } from '@/lib/dates';
import { ApiError, request } from '@/lib/api';
import { formatDateRange } from '@/lib/format';
import { colors, coverColors, fonts, radius, space } from '@/theme';

type Errors = Partial<Record<'name' | 'destination' | 'startDate' | 'endDate' | 'form', string>>;

/** Create a trip (design: NewTrip.dc.html). */
export default function NewTrip() {
  // One id per form, so tapping "Create" twice can't make two trips.
  const tripId = useRef(newId()).current;
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  const [dates, setDates] = useState<DateRange>({ start: null, end: null });
  const [currency, setCurrency] = useState('EUR');
  // The real place behind the destination, once picked from the suggestions.
  const [place, setPlace] = useState<TripLocation | null>(null);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  // Lisbon → Porto → Madrid: the days in the first place, and the places after it.
  const [firstDays, setFirstDays] = useState<DateRange>({ start: null, end: null });
  const [more, setMore] = useState<DraftPlace[]>([]);
  // Which stop the sheet is editing: 0 is the destination above, 'new' adds one.
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const pickPlace = (picked: PlaceResult) => {
    setPlace(locationOf(picked));
    setDestination(picked.label);
    // Most trips are kept in the local currency; it's still changeable.
    const local = currencyForCountry(picked.countryCode);
    if (local && !currencyTouched) setCurrency(local);
  };
  const [coverColor, setCoverColor] = useState<string>(coverColors[0]);
  // A cover photo picked before the trip exists: uploaded right after it's created.
  const [coverPhoto, setCoverPhoto] = useState<ImagePickerAsset | null>(null);
  const [coverProblem, setCoverProblem] = useState<string>();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const first: DraftPlace = { destination: destination.trim(), location: place, startDate: firstDays.start, endDate: firstDays.end };
  const stops = [first, ...more];
  const several = more.length > 0;

  const create = async () => {
    const withPlaces = several || !!firstDays.start;
    if (withPlaces && destination.trim()) {
      const problem = placeDatesProblem(stops, { startDate: dates.start, endDate: dates.end });
      if (problem) return setErrors({ form: problem });
    }
    const parsed = CreateTripInput.safeParse({
      id: tripId,
      name: name.trim() || stops.map((p) => cityOf(p.destination)).filter(Boolean).join(' → ').slice(0, 120),
      destination,
      startDate: dates.start ?? undefined,
      endDate: dates.end ?? undefined,
      baseCurrency: currency,
      coverColor,
      location: place ?? undefined,
      places: withPlaces ? stops : undefined,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = (issue.path[0] as keyof Errors) ?? 'form';
        next[key] ??= issue.message;
      }
      if (next.name && !destination) next.destination = 'Where are you going?';
      return setErrors(next);
    }

    setBusy(true);
    try {
      const trip = await request('/trips', { method: 'POST', body: parsed.data, schema: Trip });
      // The trip is made either way; a photo that fails can be added again from Edit.
      if (coverPhoto) await uploadCover(trip.id, coverPhoto).catch(() => undefined);
      router.replace(`/trips/${trip.id}`);
    } catch (e) {
      setErrors({ form: e instanceof ApiError ? e.message : 'Could not create the trip' });
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            style={styles.close}
          >
            <Body style={{ fontFamily: fonts.bold, color: colors.ink }}>Cancel</Body>
          </Pressable>
          <Title>Where are you going?</Title>

          <DestinationField
            value={destination}
            picked={!!place}
            onChangeText={(text) => {
              setDestination(text);
              setPlace(null);
            }}
            onPick={pickPlace}
            error={errors.destination}
            autoFocus
          />
          {several ? (
            <View style={{ gap: space.sm }}>
              <Label>Stops on this trip</Label>
              {stops.map((stop, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityHint="Change the place or its days"
                  onPress={() => setEditing(i)}
                  style={styles.stop}
                >
                  <Body style={styles.stopNumber}>{i + 1}</Body>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontFamily: fonts.bold, color: colors.ink }} numberOfLines={1}>
                      {stop.destination || 'Where to first?'}
                    </Body>
                    <Body style={{ fontSize: 12 }}>
                      {stop.startDate ? formatDateRange(stop.startDate, stop.endDate) : 'No days set'}
                      {stop.location ? '' : ' · not on the map'}
                    </Body>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.faint} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {destination.trim() ? (
            <Button
              label="Add another stop on this trip"
              variant="ghost"
              icon={<Feather name="plus" size={16} color={colors.accent} />}
              onPress={() => setEditing('new')}
              style={{ alignSelf: 'flex-start', minHeight: 40 }}
            />
          ) : null}
          <View style={{ gap: space.xs }}>
            <DateRangeField
              label="Dates (optional)"
              value={dates}
              onChange={setDates}
              error={errors.startDate ?? errors.endDate}
            />
            <Body style={{ fontSize: 12 }}>Gives the plan a page per day. Not sure yet? Add them later.</Body>
          </View>
          <View style={{ gap: space.xs }}>
            <Field
              label="Trip name (optional)"
              value={name}
              onChangeText={setName}
              placeholder="Lisbon with the crew"
              error={errors.name}
            />
            <Body style={{ fontSize: 12 }}>Leave it blank to use the destination.</Body>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>Cover</Label>
            <View style={styles.row}>
              {coverColors.map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  aria-checked={c === coverColor}
                  accessibilityLabel={`Cover color ${c}`}
                  onPress={() => setCoverColor(c)}
                  style={[styles.swatch, { backgroundColor: c }, c === coverColor && styles.swatchOn]}
                />
              ))}
            </View>
            {coverPhoto ? <CoverImage color={coverColor} uri={coverPhoto.uri} style={styles.preview} /> : null}
            <View style={styles.row}>
              <Button
                label={coverPhoto ? 'Change photo' : 'Choose a photo'}
                variant="outline"
                icon={<Feather name="image" size={16} color={colors.ink} />}
                onPress={async () => {
                  const picked = await pickCoverPhoto();
                  if (typeof picked === 'string') return setCoverProblem(picked);
                  setCoverProblem(undefined);
                  if (picked) setCoverPhoto(picked);
                }}
                style={{ minHeight: 40 }}
              />
              {coverPhoto ? (
                <Button label="Remove photo" variant="ghost" onPress={() => setCoverPhoto(null)} style={{ minHeight: 40 }} />
              ) : null}
            </View>
            <Body style={{ fontSize: 12 }}>
              {coverProblem ?? 'Optional. Later, in Edit, you can also pick one from the album or use a photo of the destination.'}
            </Body>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>Trip currency</Label>
            <View style={styles.row}>
              {[...new Set(['EUR', 'GBP', 'USD', 'INR', currency])].map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  aria-checked={c === currency}
                  onPress={() => {
                    setCurrency(c);
                    setCurrencyTouched(true);
                  }}
                  style={[styles.pill, c === currency && styles.pillOn]}
                >
                  <Body style={{ fontFamily: fonts.bold, color: c === currency ? colors.onFill : colors.ink }}>
                    {c}
                  </Body>
                </Pressable>
              ))}
            </View>
            <Body style={{ fontSize: 12 }}>
              Expenses are totalled and split in this currency. You can change it until the first expense.
            </Body>
          </View>

          {errors.form ? <Body style={{ color: colors.coralInk }}>{errors.form}</Body> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Create trip" onPress={create} loading={busy} />
        </View>
        <PlaceSheet
          visible={editing !== null}
          title={editing === 'new' ? 'Add a stop' : editing === 0 ? 'First stop' : `Stop ${(editing ?? 0) + 1}`}
          initial={editing === null || editing === 'new' ? null : stops[editing]!}
          tripDates={dates}
          onSave={async (saved) => {
            if (editing === 0) {
              setDestination(saved.destination);
              setPlace(saved.location);
              setFirstDays({ start: saved.startDate, end: saved.endDate });
            } else if (editing === 'new') {
              setMore((m) => [...m, saved]);
            } else if (editing !== null) {
              setMore((m) => m.map((p, i) => (i === editing - 1 ? saved : p)));
            }
            return null;
          }}
          onRemove={
            typeof editing === 'number' && editing > 0
              ? async () => {
                  setMore((m) => m.filter((_, i) => i !== editing - 1));
                  return null;
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.lg },
  close: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', gap: space.md },
  swatch: { width: 52, height: 52, borderRadius: radius.md },
  preview: { height: 120, borderRadius: radius.lg },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  stop: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  stopNumber: { width: 22, fontFamily: fonts.bold, color: colors.accent, textAlign: 'center' },
  pill: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg },
});
