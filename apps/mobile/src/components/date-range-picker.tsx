import { memo, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  applyDayTap,
  daysInMonth,
  firstWeekday,
  MONTH_NAMES,
  nightsBetween,
  spokenDate,
  toIso,
  todayIso,
  WEEKDAYS_SHORT,
  type DateRange,
} from '@/lib/dates';
import { formatDateRange } from '@/lib/format';
import { colors, fonts, radius, space } from '@/theme';
import { Button } from './ui';

const MONTHS_AHEAD = 24;
const SIDE_PADDING = space.xl;
// Top margin + title height + gap below the title; must match the Month styles.
const MONTH_TITLE_HEIGHT = 24;
const MONTH_HEADER = space.lg + MONTH_TITLE_HEIGHT + space.sm;

interface Props {
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  error?: string;
}

/** A form field that opens a calendar for picking a start and end date. */
export function DateRangeField({ label, value, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const summary = value.start ? withYear(value.start, value.end) : null;

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary ?? 'not set'}`}
        accessibilityHint="Opens a calendar"
        onPress={() => setOpen(true)}
        style={[styles.field, error ? { borderColor: colors.danger } : null]}
      >
        <Text style={[styles.fieldText, !summary && { color: '#8C867B' }]}>
          {summary ?? 'Add dates'}
        </Text>
        <CalendarIcon />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <RangeCalendar
          initial={value}
          onCancel={() => setOpen(false)}
          onDone={(range) => {
            onChange(range);
            setOpen(false);
          }}
        />
      </Modal>
    </View>
  );
}

const withYear = (start: string, end: string | null) =>
  `${formatDateRange(start, end)}, ${(end ?? start).slice(0, 4)}`;

function RangeCalendar({
  initial,
  onCancel,
  onDone,
}: {
  initial: DateRange;
  onCancel: () => void;
  onDone: (range: DateRange) => void;
}) {
  const [range, setRange] = useState<DateRange>(initial);
  const { width } = useWindowDimensions();
  const cell = Math.floor((Math.min(width, 520) - SIDE_PADDING * 2) / 7);
  const today = todayIso();

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_AHEAD }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  // Month heights are known up front, so the list can jump straight to any month.
  const layouts = useMemo(() => {
    let offset = 0;
    return months.map((m) => {
      const rows = Math.ceil((firstWeekday(m.year, m.month) + daysInMonth(m.year, m.month)) / 7);
      const length = MONTH_HEADER + rows * cell;
      const layout = { length, offset };
      offset += length;
      return layout;
    });
  }, [months, cell]);

  // Open on the month that holds the chosen start date.
  const initialIndex = useMemo(() => {
    if (!initial.start) return 0;
    const i = months.findIndex((m) => initial.start!.startsWith(toIso(m.year, m.month, 1).slice(0, 7)));
    return Math.max(0, i);
  }, [initial.start, months]);

  const nights = range.start && range.end ? nightsBetween(range.start, range.end) : null;
  const status = !range.start
    ? 'Tap the day you leave'
    : !range.end
      ? 'Now tap the day you come back'
      : `${withYear(range.start, range.end)} · ${nights === 0 ? 'Day trip' : `${nights} ${nights === 1 ? 'night' : 'nights'}`}`;

  return (
    <SafeAreaView style={styles.sheet} edges={['bottom']}>
      <View style={styles.sheetHeader}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>Cancel</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          When are you going?
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setRange({ start: null, end: null })}
          style={[styles.headerButton, { alignItems: 'flex-end' }]}
        >
          <Text style={styles.headerButtonText}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.weekdays}>
        {WEEKDAYS_SHORT.map((d, i) => (
          <Text key={i} style={[styles.weekday, { width: cell }]}>
            {d}
          </Text>
        ))}
      </View>

      <FlatList
        data={months}
        keyExtractor={(m) => `${m.year}-${m.month}`}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({ ...layouts[index]!, index })}
        contentContainerStyle={{ paddingHorizontal: SIDE_PADDING, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <Month
            year={item.year}
            month={item.month}
            cell={cell}
            today={today}
            start={range.start}
            end={range.end}
            onPick={(day) => setRange((r) => applyDayTap(r, day))}
          />
        )}
      />

      <View style={styles.footer}>
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {status}
        </Text>
        <Button
          label={range.start ? 'Done' : 'Skip for now'}
          onPress={() => onDone({ start: range.start, end: range.end ?? range.start })}
        />
      </View>
    </SafeAreaView>
  );
}

interface MonthProps {
  year: number;
  month: number;
  cell: number;
  today: string;
  start: string | null;
  end: string | null;
  onPick: (day: string) => void;
}

const Month = memo(function Month({ year, month, cell, today, start, end, onPick }: MonthProps) {
  const lead = firstWeekday(year, month);
  const count = daysInMonth(year, month);
  const slots: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => toIso(year, month, i + 1)),
  ];

  return (
    <View style={{ marginTop: space.lg }}>
      <Text style={styles.monthTitle}>
        {MONTH_NAMES[month]} {year}
      </Text>
      <View style={styles.grid}>
        {slots.map((day, i) => {
          if (!day) return <View key={`blank-${i}`} style={{ width: cell, height: cell }} />;
          const past = day < today;
          const isStart = day === start;
          const isEnd = day === end;
          const inRange = !!start && !!end && day > start && day < end;
          const endpoint = isStart || isEnd;
          // The band behind the circles joins the start and end days.
          const bandLeft = inRange || (isEnd && !!start && start !== end);
          const bandRight = inRange || (isStart && !!end && start !== end);

          return (
            <Pressable
              key={day}
              disabled={past}
              onPress={() => onPick(day)}
              accessibilityRole="button"
              accessibilityLabel={spokenDate(day)}
              aria-selected={endpoint || inRange}
              aria-disabled={past}
              style={{ width: cell, height: cell, justifyContent: 'center' }}
            >
              {bandLeft || bandRight ? (
                <View
                  style={[
                    styles.band,
                    { left: bandLeft ? 0 : cell / 2, right: bandRight ? 0 : cell / 2 },
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.day,
                  { width: cell - 6, height: cell - 6, borderRadius: (cell - 6) / 2 },
                  endpoint && styles.dayEndpoint,
                  day === today && !endpoint && styles.dayToday,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    past && styles.dayTextPast,
                    endpoint && styles.dayTextEndpoint,
                  ]}
                >
                  {Number(day.slice(8))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

function CalendarIcon() {
  // Drawn with views so no icon library is needed.
  return (
    <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
      <View style={styles.iconTop} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  field: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldText: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  icon: { width: 20, height: 18, borderWidth: 1.8, borderColor: colors.muted, borderRadius: 4 },
  iconTop: { height: 4, backgroundColor: colors.muted },

  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  headerButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  sheetTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  weekdays: {
    flexDirection: 'row',
    paddingHorizontal: SIDE_PADDING,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  weekday: { textAlign: 'center', fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  monthTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: MONTH_TITLE_HEIGHT,
    height: MONTH_TITLE_HEIGHT,
    color: colors.ink,
    marginBottom: space.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  band: { position: 'absolute', top: 3, bottom: 3, backgroundColor: colors.accentSoft },
  day: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  dayEndpoint: { backgroundColor: colors.ink },
  dayToday: { borderWidth: 1.5, borderColor: colors.accent },
  dayText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  dayTextPast: { color: '#B9B2A6' },
  dayTextEndpoint: { color: '#FFFFFF', fontFamily: fonts.bold },
  footer: {
    paddingHorizontal: SIDE_PADDING,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  status: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, textAlign: 'center' },
});
