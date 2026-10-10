import Feather from '@expo/vector-icons/Feather';
import type { Poll } from '@tagalong/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';

interface Props {
  poll: Poll;
  memberCount: number;
  /** Shown for the person who asked, so they can stop the voting. */
  canClose: boolean;
  onPick: (optionId: string) => void;
  onClose: () => void;
}

/** A poll as it appears in the conversation (design: Chat.dc.html). */
export function PollCard({ poll, memberCount, canClose, onPick, onClose }: Props) {
  const closed = poll.closedAt !== null;
  const most = Math.max(1, ...poll.options.map((o) => o.votes));

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Feather name="bar-chart-2" size={15} color={colors.accent} />
        <Text style={styles.question}>{poll.question}</Text>
      </View>

      {poll.options.map((option) => {
        const share = option.votes / most;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="checkbox"
            aria-checked={option.mine}
            aria-disabled={closed}
            disabled={closed}
            accessibilityLabel={`${option.label}, ${option.votes} ${option.votes === 1 ? 'vote' : 'votes'}`}
            onPress={() => onPick(option.id)}
            style={[styles.option, option.mine && styles.optionMine]}
          >
            <View style={[styles.bar, { width: `${Math.round(share * 100)}%` }]} />
            <View style={styles.optionRow}>
              <Feather
                name={option.mine ? 'check-circle' : 'circle'}
                size={15}
                color={option.mine ? colors.accent : colors.lineStrong}
              />
              <Text style={styles.optionLabel} numberOfLines={2}>
                {option.label}
              </Text>
              <Text style={styles.count}>{option.votes}</Text>
            </View>
          </Pressable>
        );
      })}

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {closed ? 'Voting ended · ' : poll.multi ? 'Pick as many as you like · ' : ''}
          {poll.voterCount} of {memberCount} voted
        </Text>
        {canClose && !closed ? (
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>End voting</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, gap: 6, minWidth: 240 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: 2 },
  question: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  option: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, overflow: 'hidden', minHeight: 40, justifyContent: 'center' },
  optionMine: { borderColor: colors.accent },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.accentSoft },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 10, paddingVertical: 8 },
  optionLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  count: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: 2 },
  meta: { flex: 1, fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  closeButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  closeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
});
