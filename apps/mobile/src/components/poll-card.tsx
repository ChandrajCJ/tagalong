import Feather from '@expo/vector-icons/Feather';
import type { Poll, PollOption } from '@tagalong/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';

interface Props {
  poll: Poll;
  memberCount: number;
  /** Shown for the person who asked, so they can stop the voting. */
  canClose: boolean;
  onPick: (optionId: string) => void;
  onClose: () => void;
  /** Editors can put an option on the plan once it has votes, or after voting ends. */
  canAddToPlan?: boolean;
  onAddToPlan?: (option: PollOption) => void;
  onOpenItem?: (itemId: string) => void;
}

/** A poll as it appears in the conversation (design: Chat.dc.html). */
export function PollCard({ poll, memberCount, canClose, onPick, onClose, canAddToPlan, onAddToPlan, onOpenItem }: Props) {
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
        const plannable = canAddToPlan && !option.itemId && (closed || option.votes > 0);
        // The vote and the plan button sit side by side: a button can't hold another button.
        return (
          <View key={option.id} style={[styles.option, option.mine && styles.optionMine]}>
            <View style={[styles.bar, { width: `${Math.round(share * 100)}%` }]} />
            <View style={styles.optionLine}>
              <Pressable
                accessibilityRole="checkbox"
                aria-checked={option.mine}
                aria-disabled={closed}
                disabled={closed}
                accessibilityLabel={`${option.label}, ${option.votes} ${option.votes === 1 ? 'vote' : 'votes'}`}
                onPress={() => onPick(option.id)}
                style={styles.optionRow}
              >
                <Feather
                  name={option.mine ? 'check-circle' : 'circle'}
                  size={15}
                  color={option.mine ? colors.accent : colors.lineStrong}
                />
                <Text style={styles.optionLabel} numberOfLines={2}>
                  {option.label}
                </Text>
                <Text style={styles.count}>{option.votes}</Text>
              </Pressable>
              {option.itemId ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={`${option.label} is in the plan. Open it`}
                  onPress={() => onOpenItem?.(option.itemId!)}
                  style={styles.planned}
                >
                  <Feather name="check" size={12} color={colors.accentInk} />
                  <Text style={styles.plannedText}>In plan</Text>
                </Pressable>
              ) : plannable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${option.label} to the plan`}
                  onPress={() => onAddToPlan?.(option)}
                  style={styles.addPlan}
                >
                  <Feather name="plus" size={12} color="#FFFFFF" />
                  <Text style={styles.addPlanText}>Plan</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {closed ? 'Voting ended · ' : poll.multi ? 'Pick as many as you like · ' : ''}
          {poll.voterCount} of {memberCount} voted
        </Text>
        {canAddToPlan && closed && !poll.options.some((o) => o.itemId) ? (
          <Text style={styles.meta}>Tap “+ Plan” to put the winner on a day.</Text>
        ) : null}
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
  optionLine: { flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  optionRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 10, paddingVertical: 8 },
  addPlan: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 30, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.accent },
  addPlanText: { fontFamily: fonts.bold, fontSize: 12, color: '#FFFFFF' },
  planned: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 30, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  plannedText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  optionLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  count: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: 2 },
  meta: { flex: 1, fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  closeButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  closeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
});
