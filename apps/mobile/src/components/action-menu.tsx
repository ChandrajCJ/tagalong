import Feather from '@expo/vector-icons/Feather';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

export interface MenuAction {
  icon: IconName;
  label: string;
  /** A short line under the label saying what it does. */
  hint?: string;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  title?: string;
  actions: MenuAction[];
  onClose: () => void;
}

/** A sheet of choices from the bottom of the screen, opened from a "⋯" button. */
export function ActionMenu({ visible, title, actions, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose}>
        <Pressable style={{ width: '100%' }} onPress={() => {}}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            {title ? (
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
            ) : null}
            {actions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                accessibilityHint={a.hint}
                onPress={() => {
                  onClose();
                  a.onPress();
                }}
                style={styles.action}
              >
                <Feather name={a.icon} size={18} color={a.destructive ? colors.danger : colors.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, a.destructive && { color: colors.danger }]}>{a.label}</Text>
                  {a.hint ? <Text style={styles.hint}>{a.hint}</Text> : null}
                </View>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, paddingBottom: space.lg, gap: space.sm },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.muted, marginBottom: space.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bg },
  label: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 1 },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
});
