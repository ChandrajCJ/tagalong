import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';
import { Button, Label } from './ui';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const ROW = 48;
const VISIBLE_ROWS = 4.5;

const pad = (n: number) => String(n).padStart(2, '0');

/** How far to scroll so row `index` sits in the middle of the window. */
const centre = (index: number) => Math.max(0, (index + 1) * ROW - (VISIBLE_ROWS * ROW) / 2 - ROW / 2);

/** "14:30" → {hour: 14, minute: 30}. Anything unparseable starts at 09:00. */
const parse = (value: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = m ? Number(m[1]) : 9;
  const minute = m ? Number(m[2]) : 0;
  return {
    hour: hour >= 0 && hour <= 23 ? hour : 9,
    minute: minute >= 0 && minute <= 59 ? minute : 0,
  };
};

/** "14:30" → "2:30 PM", for the button face. */
const display = (value: string) => {
  const { hour, minute } = parse(value);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${suffix}`;
};

interface Props {
  label: string;
  /** "HH:MM", or empty for no time. */
  value: string;
  placeholder?: string;
  editable?: boolean;
  onChange: (value: string) => void;
}

/** Pick a time by tapping rather than typing (replaces the old text field). */
export function TimeField({ label, value, placeholder = 'Any time', editable = true, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parse(value));
  const hourList = useRef<ScrollView>(null);
  const minuteList = useRef<ScrollView>(null);
  // Only centre when the sheet opens, never while someone is scrolling.
  const centred = useRef(false);

  useEffect(() => {
    if (open) setDraft(parse(value));
  }, [open, value]);

  /**
   * Centre the starting time once the column has been laid out. Doing it on
   * layout rather than after a timeout means it can't run before the rows
   * exist, which left the selection clipped against the top edge.
   */
  const centreOnLayout = (ref: React.RefObject<ScrollView | null>, index: number) => () => {
    if (centred.current) return;
    // A frame later: on the first callback the column may not have its height
    // yet, and scrolling then silently clamps to the top.
    requestAnimationFrame(() => ref.current?.scrollTo({ y: centre(index), animated: false }));
    if (ref === minuteList) centred.current = true;
  };

  const minuteIndex = Math.max(0, MINUTES.indexOf(draft.minute));

  const close = () => {
    centred.current = false;
    setOpen(false);
  };

  const confirm = () => {
    onChange(`${pad(draft.hour)}:${pad(draft.minute)}`);
    close();
  };

  const clear = () => {
    onChange('');
    close();
  };

  const column = (
    values: number[],
    selected: number,
    onPick: (n: number) => void,
    ref: React.RefObject<ScrollView | null>,
    name: string,
    selectedIndex: number,
  ) => (
    <ScrollView
      ref={ref}
      style={styles.column}
      contentContainerStyle={{ paddingVertical: ROW }}
      showsVerticalScrollIndicator={false}
      onLayout={centreOnLayout(ref, selectedIndex)}
      onContentSizeChange={centreOnLayout(ref, selectedIndex)}
    >
      {values.map((n) => {
        const on = n === selected;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityLabel={`${name} ${n}`}
            onPress={() => onPick(n)}
            style={[styles.option, on && styles.optionOn]}
          >
            <Text style={[styles.optionText, on && styles.optionTextOn]}>{pad(n)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Label>{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? display(value) : placeholder}`}
        accessibilityHint={editable ? 'Double tap to pick a time' : undefined}
        aria-disabled={!editable}
        disabled={!editable}
        onPress={() => setOpen(true)}
        style={[styles.trigger, !editable && { opacity: 0.6 }]}
      >
        <Feather name="clock" size={16} color={value ? colors.accent : '#8C867B'} />
        <Text style={[styles.triggerText, !value && { color: '#8C867B' }]}>
          {value ? display(value) : placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={close} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {label}
          </Text>
          <Text style={styles.preview} accessibilityLiveRegion="polite">
            {display(`${pad(draft.hour)}:${pad(draft.minute)}`)}
          </Text>

          <View style={styles.columns}>
            {column(
              HOURS,
              draft.hour,
              (hour) => setDraft((d) => ({ ...d, hour })),
              hourList,
              'Hour',
              draft.hour,
            )}
            <Text style={styles.colon}>:</Text>
            {column(
              MINUTES,
              draft.minute,
              (minute) => setDraft((d) => ({ ...d, minute })),
              minuteList,
              'Minute',
              minuteIndex,
            )}
          </View>

          <View style={styles.actions}>
            {value ? (
              <Button label="Clear" variant="outline" onPress={clear} style={{ flex: 1 }} />
            ) : null}
            <Button label="Done" onPress={confirm} style={{ flex: 1 }} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  triggerText: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  preview: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  // The wrapper clips, so the columns can't paint over the screen behind the
  // sheet. Each column needs its own height to scroll inside that window:
  // giving it `overflow: hidden` instead would stop it scrolling at all.
  columns: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, height: ROW * VISIBLE_ROWS, overflow: 'hidden' },
  column: { width: 96, height: ROW * VISIBLE_ROWS },
  colon: { fontFamily: fonts.bold, fontSize: 22, color: colors.muted },
  option: { height: ROW, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  optionOn: { backgroundColor: colors.ink },
  optionText: { fontFamily: fonts.medium, fontSize: 18, color: colors.ink },
  optionTextOn: { fontFamily: fonts.bold, color: '#FFFFFF' },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
});
