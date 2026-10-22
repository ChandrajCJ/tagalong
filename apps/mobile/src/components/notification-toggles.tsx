import type { NotificationKind, NotificationPrefs } from '@tagalong/shared';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';
import { Body } from './ui';

/** What each kind of push is about, in plain words. */
export const KIND_COPY: Record<NotificationKind, { title: string; detail: string }> = {
  chat: { title: 'Chat', detail: 'New messages, bundled: “Priya and Sam: 5 new messages”' },
  mentions: { title: '@Mentions', detail: 'When someone mentions you. These get through even when a trip is muted.' },
  plan: { title: 'Plan', detail: 'Stops added, moved to another day or removed' },
  money: { title: 'Money', detail: 'Expenses you’re part of, and when someone pays you' },
  todos: { title: 'To-dos', detail: 'One is put on you, or yours is due tomorrow' },
  trip: { title: 'Trip', detail: 'The trip’s name or dates change' },
  countdown: {
    title: 'Countdown',
    detail: '“A week to Goa! 2 to-dos still open”, then 3 days out, the evening before and the morning of',
  },
  journal: {
    title: 'Journal prompt',
    detail: '“Day 2 in Goa: what was the best moment?” in the evening during a trip, unless you’ve written that day',
  },
  memories: {
    title: 'Memories',
    detail: '“A year ago today you were in Goa”, and your recap the morning after a trip ends',
  },
};

const KINDS = Object.keys(KIND_COPY) as NotificationKind[];

/** A switch per kind of notification. */
export function NotificationToggles({
  prefs,
  disabled,
  onChange,
}: {
  prefs: Pick<NotificationPrefs, NotificationKind>;
  disabled?: boolean;
  onChange: (kind: NotificationKind, on: boolean) => void;
}) {
  return (
    <View style={styles.box}>
      {KINDS.map((kind, i) => (
        <View key={kind} style={[styles.row, i < KINDS.length - 1 && styles.divider]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{KIND_COPY[kind].title}</Text>
            <Body style={{ fontSize: 12 }}>{KIND_COPY[kind].detail}</Body>
          </View>
          <Switch
            accessibilityLabel={`${KIND_COPY[kind].title} notifications`}
            value={prefs[kind]}
            disabled={disabled}
            onValueChange={(on) => onChange(kind, on)}
            trackColor={{ true: colors.accent, false: colors.lineStrong }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
