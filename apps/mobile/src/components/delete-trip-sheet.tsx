import { TRIP_RESTORE_DAYS } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field } from './ui';

interface Props {
  visible: boolean;
  tripName: string;
  /** Returns an error to show, or null once the trip is deleted. */
  onDelete: () => Promise<string | null>;
  onClose: () => void;
}

/**
 * Deleting a trip removes it for everyone, so the owner types its name to
 * confirm, the way a careful person would read it twice.
 */
export function DeleteTripSheet({ visible, tripName, onDelete, onClose }: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTyped('');
    setError(undefined);
  }, [visible]);

  const matches = typed.trim().toLowerCase() === tripName.trim().toLowerCase();

  const confirm = async () => {
    if (!matches) return setError('Type the trip’s name exactly as it is shown');
    setBusy(true);
    const problem = await onDelete();
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            Delete this trip for everyone?
          </Text>
          <Body style={{ fontSize: 14 }}>
            The plan, chat, photos, money and files disappear for every member right away. You can restore it from
            “Recently deleted” on your trips for {TRIP_RESTORE_DAYS} days; after that it’s gone for good.
          </Body>
          <Field
            label={`Type “${tripName}” to confirm`}
            value={typed}
            onChangeText={(v) => {
              setTyped(v);
              setError(undefined);
            }}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void confirm()}
            error={error}
            maxLength={200}
          />
          <Button
            label="Delete trip"
            onPress={() => void confirm()}
            loading={busy}
            disabled={!matches}
            style={{ backgroundColor: colors.danger, borderColor: colors.danger }}
          />
          <Button label="Cancel" variant="outline" onPress={onClose} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
});
