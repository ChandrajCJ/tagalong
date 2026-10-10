import { Trip, UpdateTripInput } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateRangeField } from '@/components/date-range-picker';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import type { DateRange } from '@/lib/dates';
import { useTrip } from '@/lib/trip-context';
import { colors, coverColors, fonts, radius, space } from '@/theme';

const CURRENCIES = ['EUR', 'GBP', 'USD', 'INR'];

/** Change a trip's name, place, dates, cover or currency after creating it. */
export default function EditTrip() {
  const { trip, reload } = useTrip();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [dates, setDates] = useState<DateRange>({ start: null, end: null });
  const [currency, setCurrency] = useState('EUR');
  const [coverColor, setCoverColor] = useState<string>(coverColors[0]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const fill = (t: Trip) => {
    setName(t.name);
    setDestination(t.destination);
    setDates({ start: t.startDate, end: t.endDate });
    setCurrency(t.baseCurrency);
    setCoverColor(t.coverColor);
  };

  useEffect(() => {
    if (trip) fill(trip);
    // Fill once when the screen opens, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  if (!trip) return null;

  const save = async () => {
    const parsed = UpdateTripInput.safeParse({
      version: trip.version,
      name: name.trim() || destination.split(',')[0]?.trim(),
      destination: destination.trim(),
      startDate: dates.start,
      endDate: dates.end,
      baseCurrency: currency,
      coverColor,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the details');
    setBusy(true);
    setError(undefined);
    try {
      await request(`/trips/${trip.id}`, { method: 'PATCH', body: parsed.data, schema: Trip });
      await reload();
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const latest = Trip.safeParse(e.data.current);
        if (latest.success) fill(latest.data);
        await reload();
      }
      setError(e instanceof ApiError ? e.message : 'Could not save the trip');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.close}>
            <Body style={{ fontFamily: fonts.bold, color: colors.ink }}>Cancel</Body>
          </Pressable>
          <Title>Edit trip</Title>

          <Field label="Trip name" value={name} onChangeText={setName} placeholder="Goa with the crew" />
          <Field label="Destination" value={destination} onChangeText={setDestination} placeholder="Goa, India" />
          <View style={{ gap: space.xs }}>
            <DateRangeField label="Dates" value={dates} onChange={setDates} />
            <Body style={{ fontSize: 12 }}>
              Each day gets its own page in the Plan. Plan items already on a day keep their date.
            </Body>
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
          </View>

          <View style={{ gap: space.sm }}>
            <Label>Trip currency</Label>
            <View style={styles.row}>
              {[...new Set([...CURRENCIES, trip.baseCurrency])].map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  aria-checked={c === currency}
                  onPress={() => setCurrency(c)}
                  style={[styles.pill, c === currency && styles.pillOn]}
                >
                  <Body style={{ fontFamily: fonts.bold, color: c === currency ? '#FFFFFF' : colors.ink }}>{c}</Body>
                </Pressable>
              ))}
            </View>
            <Body style={{ fontSize: 12 }}>
              Expenses are totalled and split in this currency, so it can only change before the first expense.
            </Body>
          </View>

          {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Save changes" onPress={save} loading={busy} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.lg },
  close: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatch: { width: 52, height: 52, borderRadius: radius.md },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  pill: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg },
});
