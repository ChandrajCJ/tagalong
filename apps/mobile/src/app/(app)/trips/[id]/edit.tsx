import Feather from '@expo/vector-icons/Feather';
import { amountText, cityOf, positionBetween, Trip, TripBudget, TripPlace, UpdateTripInput } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BudgetField, readBudgetDraft, type BudgetDraft } from '@/components/budget-field';
import { CoverPhotoPicker } from '@/components/cover-photo-picker';
import { DateRangeField } from '@/components/date-range-picker';
import { PlaceSheet, type DraftPlace } from '@/components/place-sheet';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import type { DateRange } from '@/lib/dates';
import { formatDateRange } from '@/lib/format';
import { useTrip } from '@/lib/trip-context';
import { colors, coverColors, fonts, radius, space } from '@/theme';

const CURRENCIES = ['EUR', 'GBP', 'USD', 'INR'];

/** Change a trip's name, places, dates, cover or currency after creating it. */
export default function EditTrip() {
  const { trip, reload } = useTrip();
  const [name, setName] = useState('');
  const [dates, setDates] = useState<DateRange>({ start: null, end: null });
  const [currency, setCurrency] = useState('EUR');
  const [coverColor, setCoverColor] = useState<string>(coverColors[0]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // The place being edited in the sheet, or 'new' to add one. Places save straight away.
  const [editing, setEditing] = useState<TripPlace | 'new' | null>(null);
  const [placeProblem, setPlaceProblem] = useState<string>();
  // The budget as it was when the screen opened, and as edited here. Loaded separately, as most trips have none.
  const [budgetBefore, setBudgetBefore] = useState<TripBudget['budget'] | undefined>(undefined);
  const [budget, setBudget] = useState<BudgetDraft>({ mode: 'group', total: '' });
  const [budgetError, setBudgetError] = useState<string>();

  const fill = (t: Trip) => {
    setName(t.name);
    setDates({ start: t.startDate, end: t.endDate });
    setCurrency(t.baseCurrency);
    setCoverColor(t.coverColor);
  };

  useEffect(() => {
    if (trip) fill(trip);
    // Fill once when the screen opens, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  useEffect(() => {
    if (!trip?.id) return;
    void request(`/trips/${trip.id}/budget`, { schema: TripBudget })
      .then(({ budget: b }) => {
        setBudgetBefore(b);
        setBudget({ mode: b?.mode ?? 'group', total: b?.totalMinor ? amountText(b.totalMinor, trip.baseCurrency) : '' });
      })
      // Without it the row stays hidden, and the budget untouched.
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  if (!trip) return null;
  const places = trip.places;

  /** Saves one place change, then shows the trip as it is now; a problem comes back as words. */
  const placeRequest = async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object): Promise<string | null> => {
    try {
      await request(`/trips/${trip.id}/places${path}`, { method, body, ...(method === 'DELETE' ? {} : { schema: TripPlace }) });
      await reload();
      return null;
    } catch (e) {
      // Someone else changed it first: show theirs.
      if (e instanceof ApiError && e.status === 409) await reload();
      return e instanceof ApiError ? e.message : 'Couldn’t save that place. Try again.';
    }
  };

  const savePlace = (draft: DraftPlace) =>
    editing === 'new' || editing === null
      ? placeRequest('', 'POST', draft)
      : placeRequest(`/${editing.id}`, 'PATCH', { ...draft, version: editing.version });

  /** Up or down one: only the moved place gets a new position, between its new neighbours. */
  const move = async (i: number, by: -1 | 1) => {
    const place = places[i]!;
    const [before, after] = by === -1 ? [places[i - 2], places[i - 1]] : [places[i + 1], places[i + 2]];
    setPlaceProblem(
      (await placeRequest(`/${place.id}`, 'PATCH', {
        version: place.version,
        position: positionBetween(before?.position ?? null, after?.position ?? null),
      })) ?? undefined,
    );
  };

  /** What to send for the budget: only a change, so an untouched budget isn't rewritten. */
  const budgetEdit = (): UpdateTripInput['budget'] | { error: string } => {
    if (budgetBefore === undefined) return undefined;
    const total = readBudgetDraft(budget, currency);
    if (total && typeof total === 'object') return total;
    if (!budgetBefore) return total ? { mode: budget.mode, totalMinor: total } : undefined;
    if (budgetBefore.mode === budget.mode && budgetBefore.totalMinor === total) return undefined;
    // A cleared total keeps any category limits; with none, the budget goes.
    return { mode: budget.mode, totalMinor: total };
  };

  const save = async () => {
    const budgetChange = budgetEdit();
    if (budgetChange && 'error' in budgetChange) return setBudgetError(budgetChange.error);
    setBudgetError(undefined);
    const parsed = UpdateTripInput.safeParse({
      version: trip.version,
      name: name.trim() || cityOf(trip.destination),
      startDate: dates.start,
      endDate: dates.end,
      baseCurrency: currency,
      coverColor,
      budget: budgetChange,
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
          <View style={{ gap: space.sm }}>
            <Label>{places.length > 1 ? 'Places, in order' : 'Destination'}</Label>
            {places.map((p, i) => (
              <View key={p.id} style={styles.place}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Change the place or its days"
                  onPress={() => setEditing(p)}
                  style={styles.placeMain}
                >
                  <Body style={{ fontFamily: fonts.bold, color: colors.ink }} numberOfLines={1}>
                    {places.length > 1 ? `${i + 1}. ` : ''}
                    {p.destination}
                  </Body>
                  <Body style={{ fontSize: 12 }}>
                    {[p.startDate ? formatDateRange(p.startDate, p.endDate) : null, p.location ? 'On the map' : 'Not on the map: tap to pick it']
                      .filter(Boolean)
                      .join(' · ')}
                  </Body>
                </Pressable>
                {places.length > 1 ? (
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${cityOf(p.destination)} earlier`}
                      disabled={i === 0}
                      onPress={() => void move(i, -1)}
                      style={[styles.arrow, i === 0 && { opacity: 0.3 }]}
                    >
                      <Feather name="arrow-up" size={18} color={colors.ink} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${cityOf(p.destination)} later`}
                      disabled={i === places.length - 1}
                      onPress={() => void move(i, 1)}
                      style={[styles.arrow, i === places.length - 1 && { opacity: 0.3 }]}
                    >
                      <Feather name="arrow-down" size={18} color={colors.ink} />
                    </Pressable>
                  </View>
                ) : (
                  <Feather name="chevron-right" size={18} color={colors.faint} />
                )}
              </View>
            ))}
            {placeProblem ? <Body style={{ color: colors.coralInk }}>{placeProblem}</Body> : null}
            <Button
              label="Add another stop on this trip"
              variant="ghost"
              icon={<Feather name="plus" size={16} color={colors.accent} />}
              onPress={() => setEditing('new')}
              style={{ alignSelf: 'flex-start', minHeight: 40 }}
            />
            <Body style={{ fontSize: 12 }}>Places save as soon as you change them.</Body>
          </View>
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
            <CoverPhotoPicker trip={trip} onChanged={reload} />
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
                  <Body style={{ fontFamily: fonts.bold, color: c === currency ? colors.onFill : colors.ink }}>{c}</Body>
                </Pressable>
              ))}
            </View>
            <Body style={{ fontSize: 12 }}>
              Expenses are totalled and split in this currency, so it can only change before the first expense.
            </Body>
          </View>

          {budgetBefore !== undefined ? (
            <BudgetField
              value={budget}
              onChange={setBudget}
              currency={currency}
              error={budgetError}
              open={!!budgetBefore}
              hint={
                budgetBefore && Object.keys(budgetBefore.categories).length > 0
                  ? 'Clearing the total keeps the category limits. Change those, or remove the budget, on the Money tab.'
                  : undefined
              }
            />
          ) : null}

          {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Save changes" onPress={save} loading={busy} />
        </View>
        <PlaceSheet
          visible={editing !== null}
          title={editing === 'new' ? 'Add a stop' : editing ? `Edit ${cityOf(editing.destination)}` : ''}
          initial={editing && editing !== 'new' ? editing : null}
          tripDates={{ start: trip.startDate, end: trip.endDate }}
          onSave={savePlace}
          onRemove={editing && editing !== 'new' && places.length > 1 ? () => placeRequest(`/${editing.id}`, 'DELETE') : undefined}
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 60, paddingLeft: space.md, paddingRight: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  placeMain: { flex: 1, paddingVertical: space.sm, gap: 2 },
  arrow: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 52, height: 52, borderRadius: radius.md },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  pill: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg },
});
