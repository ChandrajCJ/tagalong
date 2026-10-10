import Feather from '@expo/vector-icons/Feather';
import {
  BOOKING_TYPES,
  deviceTimezone,
  toInstant,
  wallClock,
  type Booking,
  type BookingType,
  type TripDocument,
} from '@tagalong/shared';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BOOKING_META, DETAIL_FIELDS, PROVIDER_FIELD } from '@/lib/bookings';
import type { DateRange } from '@/lib/dates';
import { colors, fonts, radius, space } from '@/theme';
import { DateRangeField } from './date-range-picker';
import { TimeField } from './time-field';
import { Body, Button, Field, Label } from './ui';

/** What the sheet produces, in the shape the API takes. */
export interface BookingFields {
  type: BookingType;
  provider: string | null;
  reference: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  details: Record<string, string | number>;
  costMinor: number | null;
  costCurrency: string | null;
  documentId: string | null;
}

export type SaveResult = { ok: true } | { conflict: Booking } | { error: string };

interface Props {
  visible: boolean;
  booking?: Booking;
  /** The type to start with for a new booking, from the plan item's type. */
  defaultType: BookingType;
  currency: string;
  /** The trip's files, so the confirmation can be attached. */
  documents: TripDocument[];
  onSave: (fields: BookingFields) => Promise<SaveResult>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/** Hotels mostly check in mid-afternoon and out late morning. */
const DEFAULT_TIMES: Partial<Record<BookingType, { start: string; end: string }>> = {
  stay: { start: '15:00', end: '11:00' },
};

const fromBooking = (b: Booking | undefined, type: BookingType) => {
  const tz = b?.timezone ?? deviceTimezone();
  const start = b?.startsAt ? wallClock(b.startsAt, tz) : null;
  const end = b?.endsAt ? wallClock(b.endsAt, tz) : null;
  return {
    type: b?.type ?? type,
    provider: b?.provider ?? '',
    reference: b?.reference ?? '',
    dates: {
      start: start?.date ?? null,
      // An end on the same day as the start is shown as a single date.
      end: end && end.date !== start?.date ? end.date : null,
    } as DateRange,
    startTime: start?.time ?? '',
    endTime: end?.time ?? '',
    timezone: tz,
    details: Object.fromEntries(
      Object.entries(b?.details ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)]),
    ) as Record<string, string>,
    cost: b?.costMinor != null ? String(b.costMinor / 100) : '',
    documentId: b?.documentId ?? null,
  };
};

export function BookingSheet(props: Props) {
  const { visible, booking, defaultType, currency, documents, onSave, onDelete, onClose } = props;
  const [form, setForm] = useState(() => fromBooking(booking, defaultType));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (visible) {
      const initial = fromBooking(booking, defaultType);
      setForm(initial);
      setErrors({});
      setNotice(undefined);
      // Open "More details" only when there's something in it already.
      const extras = DETAIL_FIELDS[initial.type].filter((f) => f.more).some((f) => initial.details[f.key]);
      setShowMore(!!booking && (extras || !!booking.endsAt || booking.costMinor != null || !!booking.documentId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, booking?.id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const setType = (type: BookingType) =>
    setForm((f) => {
      // Keep only the details the new type understands, so switching can't smuggle fields across.
      const allowed = new Set(DETAIL_FIELDS[type].map((d) => d.key));
      const defaults = DEFAULT_TIMES[type];
      return {
        ...f,
        type,
        details: Object.fromEntries(Object.entries(f.details).filter(([k]) => allowed.has(k))),
        startTime: f.startTime || defaults?.start || '',
        endTime: f.endTime || defaults?.end || '',
      };
    });

  const meta = BOOKING_META[form.type];

  const save = async () => {
    const next: Record<string, string> = {};
    const { start, end } = form.dates;
    if (form.startTime && !start) next.dates = 'Pick a date for that time';
    if (start && !form.startTime) next.startTime = 'Add a time';
    if (end && !form.endTime) next.endTime = 'Add a time';
    const cost = form.cost.trim().replace(',', '.');
    if (cost && (Number.isNaN(Number(cost)) || Number(cost) < 0)) next.cost = 'Enter an amount like 120 or 89.50';

    const startsAt = start && form.startTime ? toInstant(start, form.startTime, form.timezone) : null;
    const endsAt =
      start && form.endTime && meta.ends
        ? toInstant(end ?? start, form.endTime, form.timezone)
        : null;
    if (startsAt && endsAt && endsAt < startsAt) next.endTime = 'Ends before it starts';
    if (next.endTime) setShowMore(true);
    if (Object.values(next).some(Boolean)) return setErrors(next);

    // Drop empty fields, and send numbers as numbers.
    const details: Record<string, string | number> = {};
    for (const field of DETAIL_FIELDS[form.type]) {
      const raw = (form.details[field.key] ?? '').trim();
      if (!raw) continue;
      details[field.key] = field.numeric ? Number(raw) : raw;
    }

    setBusy(true);
    const result = await onSave({
      type: form.type,
      provider: form.provider.trim() || null,
      reference: form.reference.trim().toUpperCase() || null,
      startsAt,
      endsAt,
      timezone: form.timezone,
      details,
      costMinor: cost ? Math.round(Number(cost) * 100) : null,
      costCurrency: cost ? currency : null,
      documentId: form.documentId,
    });
    setBusy(false);

    if ('ok' in result) return onClose();
    if ('conflict' in result) {
      setForm(fromBooking(result.conflict, defaultType));
      setNotice("Someone changed this while you were editing. You're now seeing the latest version.");
      return;
    }
    setNotice(result.error);
  };

  const confirmDelete = () =>
    Alert.alert('Remove this booking?', 'The plan item stays; only the booking details go.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await onDelete?.();
          onClose();
        },
      },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerText}>Cancel</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {booking ? 'Edit booking' : 'Add booking'}
            </Text>
            <View style={styles.headerButton} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {notice ? (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Feather name="info" size={16} color={colors.coralInk} />
                <Body style={{ flex: 1, color: colors.coralInk }}>{notice}</Body>
              </View>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Label>What is it?</Label>
              <View style={styles.chips}>
                {BOOKING_TYPES.map((t) => {
                  const on = form.type === t;
                  return (
                    <Pressable
                      key={t}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => setType(t)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Feather name={BOOKING_META[t].icon} size={14} color={on ? '#FFFFFF' : colors.ink} />
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{BOOKING_META[t].label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Body style={{ fontSize: 13 }}>Only add what you have to hand; everything here is optional.</Body>

            <Field
              label={PROVIDER_FIELD[form.type].label}
              value={form.provider}
              onChangeText={(v) => set('provider', v)}
              placeholder={PROVIDER_FIELD[form.type].placeholder}
            />
            <Field
              label="Confirmation code"
              value={form.reference}
              onChangeText={(v) => set('reference', v)}
              placeholder="X7K2QP"
              autoCapitalize="characters"
              autoCorrect={false}
            />

            {DETAIL_FIELDS[form.type]
              .filter((f) => !f.more)
              .map((f) => (
                <Field
                  key={`${form.type}-${f.key}`}
                  label={f.label}
                  value={form.details[f.key] ?? ''}
                  onChangeText={(v) => set('details', { ...form.details, [f.key]: v })}
                  placeholder={f.placeholder}
                  keyboardType={f.numeric ? 'number-pad' : 'default'}
                />
              ))}

            <DateRangeField
              label={form.type === 'stay' || form.type === 'car' ? 'Dates' : 'Date'}
              value={form.dates}
              onChange={(range) => {
                set('dates', range);
                // An end day needs an end time, which lives under "More details".
                if (range.end) setShowMore(true);
              }}
              error={errors.dates}
            />
            {meta.ends && (form.type === 'stay' || form.type === 'car') ? (
              <Body style={{ fontSize: 12, marginTop: -space.sm }}>
                Tap the {meta.starts.toLowerCase()} day, then the {meta.ends.toLowerCase()} day.
              </Body>
            ) : null}
            <View style={styles.row}>
              <TimeField label={meta.starts} value={form.startTime} onChange={(v) => set('startTime', v)} />
              {meta.ends && showMore ? (
                <TimeField label={meta.ends} value={form.endTime} placeholder="Not set" onChange={(v) => set('endTime', v)} />
              ) : null}
            </View>
            {errors.startTime || errors.endTime ? (
              <Text style={styles.fieldError}>{errors.startTime || errors.endTime}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              aria-expanded={showMore}
              onPress={() => setShowMore((v) => !v)}
              style={styles.moreToggle}
            >
              <Feather name={showMore ? 'chevron-up' : 'chevron-down'} size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.moreTitle}>{showMore ? 'Fewer details' : 'More details'}</Text>
                {!showMore ? (
                  <Text style={styles.moreHint} numberOfLines={1}>
                    {[
                      meta.ends ? `${meta.ends.toLowerCase()} time` : null,
                      ...DETAIL_FIELDS[form.type].filter((f) => f.more).map((f) => f.label.toLowerCase()),
                      'cost',
                      'confirmation file',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                ) : null}
              </View>
            </Pressable>

            {showMore ? (
            <>
            <Body style={{ fontSize: 12 }}>Times are in {form.timezone.replace(/_/g, ' ')}.</Body>
            {DETAIL_FIELDS[form.type]
              .filter((f) => f.more)
              .map((f) => (
                <Field
                  key={`${form.type}-${f.key}`}
                  label={f.label}
                  value={form.details[f.key] ?? ''}
                  onChangeText={(v) => set('details', { ...form.details, [f.key]: v })}
                  placeholder={f.placeholder}
                  keyboardType={f.numeric ? 'number-pad' : 'default'}
                />
              ))}

            <Field
              label={`Total cost (${currency}, optional)`}
              value={form.cost}
              onChangeText={(v) => set('cost', v)}
              placeholder="240"
              keyboardType="decimal-pad"
              error={errors.cost}
            />

            <View style={{ gap: space.sm }}>
              <Label>Confirmation file</Label>
              {documents.length === 0 ? (
                <Body style={{ fontSize: 13 }}>
                  Add the PDF or a screenshot under Overview → Tickets & files, then attach it here.
                </Body>
              ) : (
                <View style={{ gap: space.xs }}>
                  {[null, ...documents].map((doc) => {
                    const on = form.documentId === (doc?.id ?? null);
                    return (
                      <Pressable
                        key={doc?.id ?? 'none'}
                        accessibilityRole="radio"
                        aria-checked={on}
                        onPress={() => set('documentId', doc?.id ?? null)}
                        style={[styles.docRow, on && styles.docRowOn]}
                      >
                        <Feather
                          name={on ? 'check-circle' : 'circle'}
                          size={16}
                          color={on ? colors.accent : colors.lineStrong}
                        />
                        <Text style={styles.docText} numberOfLines={1}>
                          {doc ? doc.name : 'No file'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
            </>
            ) : null}

            {booking && onDelete ? <Button label="Remove booking" variant="ghost" onPress={confirmDelete} /> : null}
          </ScrollView>

          <View style={styles.footer}>
            <Button label={booking ? 'Save changes' : 'Add booking'} onPress={save} loading={busy} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md },
  headerButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  body: { padding: space.xl, gap: space.lg },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  moreToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  moreTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  moreHint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  fieldError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: -space.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  docRowOn: { borderColor: colors.accent },
  docText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
