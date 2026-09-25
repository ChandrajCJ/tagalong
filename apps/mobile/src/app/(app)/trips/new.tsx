import { CreateTripInput, newId, Trip } from '@tagalong/shared';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateRangeField } from '@/components/date-range-picker';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import type { DateRange } from '@/lib/dates';
import { ApiError, request } from '@/lib/api';
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
  const [coverColor, setCoverColor] = useState<string>(coverColors[0]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const parsed = CreateTripInput.safeParse({
      id: tripId,
      name: name.trim() || destination.split(',')[0]?.trim(),
      destination,
      startDate: dates.start ?? undefined,
      endDate: dates.end ?? undefined,
      baseCurrency: currency,
      coverColor,
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

          <Field
            label="Destination"
            value={destination}
            onChangeText={setDestination}
            placeholder="Lisbon, Portugal"
            error={errors.destination}
            autoFocus
          />
          <DateRangeField
            label="Dates"
            value={dates}
            onChange={setDates}
            error={errors.startDate ?? errors.endDate}
          />
          <Field
            label="Trip name"
            value={name}
            onChangeText={setName}
            placeholder="Lisbon with the crew"
            error={errors.name}
          />

          <View style={{ gap: space.sm }}>
            <Label>Cover</Label>
            <View style={styles.row}>
              {coverColors.map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: c === coverColor }}
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
              {['EUR', 'GBP', 'USD', 'INR'].map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: c === currency }}
                  onPress={() => setCurrency(c)}
                  style={[styles.pill, c === currency && styles.pillOn]}
                >
                  <Body style={{ fontFamily: fonts.bold, color: c === currency ? '#FFFFFF' : colors.ink }}>
                    {c}
                  </Body>
                </Pressable>
              ))}
            </View>
          </View>

          {errors.form ? <Body style={{ color: colors.coralInk }}>{errors.form}</Body> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Create trip" onPress={create} loading={busy} />
        </View>
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
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  pill: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg },
});
