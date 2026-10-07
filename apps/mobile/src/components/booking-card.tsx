import Feather from '@expo/vector-icons/Feather';
import type { Booking } from '@tagalong/shared';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOOKING_META, DETAIL_FIELDS, formatInZone, routeOf, titleOf } from '@/lib/bookings';
import { formatCost } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';

/** Fields the headline already shows, so they aren't repeated underneath. */
const IN_HEADLINE = new Set(['from', 'to', 'flightNumber', 'trainNumber']);

interface Props {
  booking: Booking;
  onPress?: () => void;
}

/** A booking as a boarding-pass style card (design: Booking.dc.html). */
export function BookingCard({ booking, onPress }: Props) {
  const [copied, setCopied] = useState(false);
  const meta = BOOKING_META[booking.type];
  const route = routeOf(booking);
  const tz = booking.timezone;

  const extras = DETAIL_FIELDS[booking.type]
    .filter((f) => !IN_HEADLINE.has(f.key))
    .map((f) => ({ label: f.label, value: booking.details[f.key] }))
    .filter((f): f is { label: string; value: string | number } =>
      typeof f.value === 'string' ? f.value.trim() !== '' : typeof f.value === 'number',
    );

  const copy = async () => {
    if (!booking.reference) return;
    await Clipboard.setStringAsync(booking.reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /*
   * The journey half opens the editor and the small print sits beside it, not
   * inside it: a button can't contain the copy button, and a screen reader
   * reads a button as one element, so a nested one could never be reached.
   */
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${meta.label}: ${titleOf(booking)}`}
        accessibilityHint={onPress ? 'Double tap to edit' : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={styles.journey}
      >
        <View style={styles.top}>
          <View style={styles.badge}>
            <Feather name={meta.icon} size={14} color={colors.accentInk} />
            <Text style={styles.badgeText}>{meta.label}</Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {titleOf(booking)}
          </Text>
        </View>

        {route ? (
          // From A to B: the big departure and arrival, like a boarding pass.
          <View style={styles.route}>
            <View style={{ flex: 1 }}>
              <Text style={styles.place}>{String(booking.details.from)}</Text>
              {booking.startsAt ? (
                <Text style={styles.when}>{formatInZone(booking.startsAt, tz)}</Text>
              ) : null}
            </View>
            <Feather name="arrow-right" size={20} color={colors.muted} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={styles.place}>{String(booking.details.to)}</Text>
              {booking.endsAt ? (
                <Text style={styles.when}>{formatInZone(booking.endsAt, tz)}</Text>
              ) : null}
            </View>
          </View>
        ) : booking.startsAt ? (
          <View style={styles.times}>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeLabel}>{meta.starts}</Text>
              <Text style={styles.timeValue}>{formatInZone(booking.startsAt, tz)}</Text>
            </View>
            {meta.ends && booking.endsAt ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.timeLabel}>{meta.ends}</Text>
                <Text style={styles.timeValue}>{formatInZone(booking.endsAt, tz)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {/* The tear line between the journey and the small print. */}
      <View style={styles.tear} />

      <View style={styles.footer}>
        {booking.reference ? (
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Confirmation</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Copy confirmation code ${booking.reference}`}
              onPress={copy}
              style={styles.reference}
            >
              <Text style={styles.referenceText} selectable>
                {booking.reference}
              </Text>
              <Feather name={copied ? 'check' : 'copy'} size={14} color={colors.accent} />
            </Pressable>
          </View>
        ) : null}
        {extras.map((f) => (
          <View key={f.label} style={styles.cell}>
            <Text style={styles.cellLabel}>{f.label}</Text>
            <Text style={styles.cellValue}>{String(f.value)}</Text>
          </View>
        ))}
        {booking.costMinor != null && booking.costCurrency ? (
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Cost</Text>
            <Text style={styles.cellValue}>
              {formatCost(booking.costMinor, booking.costCurrency)}
            </Text>
          </View>
        ) : null}
      </View>
      {copied ? (
        <Text style={styles.copied} accessibilityLiveRegion="polite">
          Copied
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  journey: { gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  route: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  place: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  when: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  times: { flexDirection: 'row', gap: space.lg },
  timeLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  timeValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  tear: {
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    marginHorizontal: -space.lg,
  },
  footer: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, columnGap: space.xl },
  cell: { gap: 2, minWidth: 90 },
  cellLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cellValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  reference: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  referenceText: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: 1.5, color: colors.ink },
  copied: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
});
