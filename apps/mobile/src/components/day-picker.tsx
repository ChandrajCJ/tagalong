import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ANYTIME, shortDate, type DayKey } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button } from './ui';

interface Props {
  visible: boolean;
  title: string;
  /** What this is for, e.g. the idea's name. */
  subtitle?: string;
  days: DayKey[];
  busy?: boolean;
  onPick: (date: string | null) => void;
  onClose: () => void;
}

/** "Which day?" — used when an idea moves into the plan. */
export function DayPicker({ visible, title, subtitle, days, busy, onPick, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.grabber} />
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Body numberOfLines={2}>{subtitle}</Body> : null}

        <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onPick(null)}
            style={styles.option}
          >
            <Text style={styles.optionText}>No day yet</Text>
          </Pressable>
          {days
            .filter((d) => d !== ANYTIME)
            .map((d, i) => (
              <Pressable
                key={d}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onPick(d)}
                style={styles.option}
              >
                <Text style={styles.optionDay}>Day {i + 1}</Text>
                <Text style={styles.optionText}>{shortDate(d)}</Text>
              </Pressable>
            ))}
        </ScrollView>

        <Button label="Cancel" variant="outline" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  optionDay: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  optionText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
});
