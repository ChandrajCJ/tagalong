import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field } from './ui';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  label: string;
  initial: string;
  saveLabel?: string;
  /** Returns an error to show, or null when saved. */
  onSave: (value: string) => Promise<string | null>;
  onClose: () => void;
}

/** Asks for one line of text, like a new name for a file. */
export function TextPrompt({ visible, title, message, label, initial, saveLabel = 'Save', onSave, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValue(initial);
    setError(undefined);
  }, [visible, initial]);

  const save = async () => {
    if (!value.trim()) return setError('This can’t be empty');
    setBusy(true);
    const problem = await onSave(value.trim());
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {message ? <Body style={{ fontSize: 13 }}>{message}</Body> : null}
          <Field
            label={label}
            value={value}
            onChangeText={(v) => {
              setValue(v);
              setError(undefined);
            }}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            error={error}
            maxLength={200}
          />
          <Button label={saveLabel} onPress={() => void save()} loading={busy} />
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
