import Feather from '@expo/vector-icons/Feather';
import { REACTIONS } from '@tagalong/shared';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalMessage } from '@/lib/chat';
import { colors, fonts, radius, space } from '@/theme';

interface Props {
  message: LocalMessage | null;
  canReact: boolean;
  canAddToPlan: boolean;
  onReact: (emoji: string) => void;
  onAddToPlan: () => void;
  onAddExpense: () => void;
  onCopy: () => void;
  onClose: () => void;
}

/** Long-press menu for a message: react, add it to the plan or the money, or copy it. */
export function MessageActions({
  message,
  canReact,
  canAddToPlan,
  onReact,
  onAddToPlan,
  onAddExpense,
  onCopy,
  onClose,
}: Props) {
  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose}>
        {/* Swallow presses inside the sheet so they don't close it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {message ? (
            <Text style={styles.preview} numberOfLines={3}>
              {message.body}
            </Text>
          ) : null}
          {canReact ? (
            <View style={styles.reactions}>
              {REACTIONS.map((emoji) => {
                const mine = message?.reactions.some((r) => r.emoji === emoji && r.mine);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                    aria-selected={!!mine}
                    onPress={() => onReact(emoji)}
                    style={[styles.emoji, mine && styles.emojiOn]}
                  >
                    <Text style={{ fontSize: 26 }}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {canAddToPlan ? (
            <>
              <Action icon="calendar" label="Add to plan" onPress={onAddToPlan} />
              <Action icon="credit-card" label="Add as expense" onPress={onAddExpense} />
            </>
          ) : null}
          <Action icon="copy" label="Copy text" onPress={onCopy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Feather name={icon} size={18} color={colors.ink} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, paddingBottom: 40, gap: space.md },
  preview: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  reactions: { flexDirection: 'row', justifyContent: 'space-between' },
  emoji: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  emojiOn: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.accent },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bg },
  actionText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
