import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

const MAX_OPTIONS = 6;

export interface PollDraft {
  question: string;
  options: string[];
  multi: boolean;
}

interface Props {
  visible: boolean;
  onAsk: (draft: PollDraft) => Promise<string | null>;
  onClose: () => void;
}

/** "Sintra on Friday or Saturday?" — asks the group in the chat. */
export function PollComposer({ visible, onAsk, onClose }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [errors, setErrors] = useState<{ question?: string; options?: string }>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setQuestion('');
      setOptions(['', '']);
      setMulti(false);
      setErrors({});
      setNotice(undefined);
    }
  }, [visible]);

  const setOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
    setErrors((e) => ({ ...e, options: undefined }));
  };

  const ask = async () => {
    const filled = options.map((o) => o.trim()).filter(Boolean);
    const next: typeof errors = {};
    if (!question.trim()) next.question = 'Ask a question';
    if (filled.length < 2) next.options = 'Give at least two options';
    if (next.question || next.options) return setErrors(next);

    setBusy(true);
    const error = await onAsk({ question: question.trim(), options: filled, multi });
    setBusy(false);
    if (error) return setNotice(error);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerText}>Cancel</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              Ask the group
            </Text>
            <View style={styles.headerButton} />
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {notice ? (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Feather name="info" size={16} color={colors.coralInk} />
                <Body style={{ flex: 1, color: colors.coralInk }}>{notice}</Body>
              </View>
            ) : null}

            <Field
              label="Question"
              value={question}
              onChangeText={(v) => {
                setQuestion(v);
                setErrors((e) => ({ ...e, question: undefined }));
              }}
              placeholder="Sintra on Friday or Saturday?"
              error={errors.question}
              autoFocus
            />

            <View style={{ gap: space.sm }}>
              <Label>Options</Label>
              {options.map((option, i) => (
                <View key={i} style={styles.optionRow}>
                  <Field
                    label={`Option ${i + 1}`}
                    value={option}
                    onChangeText={(v) => setOption(i, v)}
                    placeholder={i === 0 ? 'Friday' : i === 1 ? 'Saturday' : 'Another option'}
                    style={{ flex: 1 }}
                  />
                  {options.length > 2 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove option ${i + 1}`}
                      onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                      style={styles.removeOption}
                    >
                      <Feather name="x" size={18} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {errors.options ? <Text style={styles.error}>{errors.options}</Text> : null}
              {options.length < MAX_OPTIONS ? (
                <Button
                  label="Add another option"
                  variant="outline"
                  icon={<Feather name="plus" size={16} color={colors.ink} />}
                  onPress={() => setOptions((prev) => [...prev, ''])}
                />
              ) : null}
            </View>

            <Pressable
              accessibilityRole="switch"
              aria-checked={multi}
              onPress={() => setMulti((m) => !m)}
              style={styles.toggle}
            >
              <Feather
                name={multi ? 'check-square' : 'square'}
                size={20}
                color={multi ? colors.accent : colors.lineStrong}
              />
              <Body style={{ flex: 1, color: colors.ink }}>People can pick more than one</Body>
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            <Button label="Ask" onPress={ask} loading={busy} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md },
  headerButton: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  headerText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  body: { padding: space.xl, gap: space.lg },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  optionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  removeOption: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
