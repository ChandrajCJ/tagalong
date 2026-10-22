import Feather from '@expo/vector-icons/Feather';
import { formatMoney, minorDigits, type BudgetSummary } from '@tagalong/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CATEGORY_META } from '@/lib/money';
import { colors, fonts, radius, space } from '@/theme';
import { Body } from './ui';

interface Props {
  summary: BudgetSummary;
  currency: string;
  /** Whether the trip has started, for "the 5 days left" against "the 5 days of the trip". */
  started: boolean;
  /** Editors and owners can change it; everyone else just sees it. */
  onEdit?: () => void;
}

/** Spent (solid) and planned (lighter) against a limit; the bar turns coral once over. */
function Bar({ spent, planned, limit }: { spent: number; planned: number; limit: number }) {
  const over = spent > limit;
  const scale = Math.max(limit, spent + planned, 1);
  const pct = (x: number) => `${Math.min(100, (x / scale) * 100)}%` as const;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: pct(spent), backgroundColor: over ? colors.coral : colors.accent }]} />
      {planned > 0 ? <View style={[styles.fill, { width: pct(planned), backgroundColor: colors.accentTrack }]} /> : null}
    </View>
  );
}

/**
 * "₹18,400 of ₹25,000 spent · ₹6,600 left · about ₹1,320 a day for the 5
 * days left", with planned costs, a pace warning and per-category bars.
 * Only shown when the trip has a budget.
 */
export function BudgetCard({ summary: s, currency, started, onEdit }: Props) {
  const money = (minor: number) => formatMoney(minor, currency);
  // "About ₹4,000 over" reads better without the cents.
  const unit = 10 ** minorDigits(currency);
  const rough = (minor: number) => money(Math.round(minor / unit) * unit);
  const each = s.mode === 'per_person';

  const headline =
    s.limitMinor !== null
      ? `${money(s.spentMinor)} of ${money(s.limitMinor)}`
      : `${money(s.spentMinor)} spent`;
  const left =
    s.leftMinor === null
      ? null
      : s.leftMinor >= 0
        ? `${money(s.leftMinor)} left`
        : `${money(-s.leftMinor)} over`;
  const days = s.daysLeft ?? 0;
  const perDay =
    s.perDayMinor !== null && days > 0
      ? days === 1
        ? `about ${money(s.perDayMinor)} for the last day`
        : `about ${money(s.perDayMinor)} a day for the ${days} days ${started ? 'left' : 'of the trip'}`
      : null;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.head}>
        <Text style={styles.label}>{each ? 'Your budget' : 'Budget'}</Text>
        {each ? <Text style={styles.tag}>Each person</Text> : null}
        <View style={{ flex: 1 }} />
        {onEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Change the budget" onPress={onEdit} style={styles.edit}>
            <Feather name="edit-2" size={14} color={colors.accent} />
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.headline}>
        {headline}
        {s.limitMinor !== null ? <Text style={styles.headlineSoft}> {each ? 'your share' : 'spent'}</Text> : null}
      </Text>
      {s.limitMinor !== null ? <Bar spent={s.spentMinor} planned={s.plannedMinor} limit={s.limitMinor} /> : null}
      {left || perDay ? (
        <Body style={[styles.line, s.leftMinor !== null && s.leftMinor < 0 && { color: colors.coralInk }]}>
          {[left, perDay].filter(Boolean).join(' · ')}
        </Body>
      ) : null}
      {s.plannedMinor > 0 ? (
        <View style={styles.legend}>
          <View style={[styles.swatch, { backgroundColor: colors.accentTrack }]} />
          <Body style={styles.line}>
            {money(s.plannedMinor)} planned: plan items and bookings not paid yet{each ? ' (your share)' : ''}
          </Body>
        </View>
      ) : null}
      {s.projectedOverMinor !== null ? (
        <View style={styles.pace}>
          <Feather name="trending-up" size={16} color={colors.coralInk} />
          <Text style={styles.paceText}>At this pace you’ll go about {rough(s.projectedOverMinor)} over.</Text>
        </View>
      ) : null}
      {each ? <Body style={styles.line}>The group has spent {money(s.groupSpentMinor)} in all.</Body> : null}

      {s.categories.length > 0 ? (
        <View style={styles.categories}>
          {s.categories.map((c) => (
            <View key={c.category} style={{ gap: 4 }}>
              <View style={styles.categoryRow}>
                <Feather name={CATEGORY_META[c.category].icon} size={14} color={colors.accent} />
                <Text style={styles.categoryName}>{CATEGORY_META[c.category].label}</Text>
                <Text
                  style={[styles.categoryAmount, c.limitMinor !== null && c.spentMinor > c.limitMinor && { color: colors.coralInk }]}
                >
                  {c.limitMinor !== null ? `${money(c.spentMinor)} of ${money(c.limitMinor)}` : money(c.spentMinor)}
                </Text>
              </View>
              {c.limitMinor !== null ? <Bar spent={c.spentMinor} planned={c.plannedMinor} limit={c.limitMinor} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  tag: { fontFamily: fonts.bold, fontSize: 11, color: colors.accentInk, backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: space.sm },
  editText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  headline: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  headlineSoft: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  line: { fontSize: 13 },
  track: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.accentWash },
  fill: { height: '100%' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  pace: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  paceText: { flex: 1, fontFamily: fonts.bold, fontSize: 13, color: colors.coralInk },
  categories: { gap: space.md, marginTop: space.sm, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.divider },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  categoryName: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  categoryAmount: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
});
