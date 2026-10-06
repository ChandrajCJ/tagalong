import Feather from '@expo/vector-icons/Feather';
import { ITEM_TYPES, type Idea, type ItemType } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import { ITEM_TYPE_META } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

/** The fields the sheet edits, in the shape the API takes. */
export interface IdeaFields {
  title: string;
  type: ItemType;
  note: string | null;
  url: string | null;
}

export type SaveResult = { ok: true } | { conflict: Idea } | { error: string };

interface Props {
  visible: boolean;
  /** The idea being edited, or undefined to add a new one. */
  idea?: Idea;
  canEdit: boolean;
  onSave: (fields: IdeaFields) => Promise<SaveResult>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

const fromIdea = (idea: Idea | undefined) => ({
  title: idea?.title ?? '',
  type: idea?.type ?? ('activity' as ItemType),
  note: idea?.note ?? '',
  url: idea?.url ?? '',
});

export function IdeaSheet({ visible, idea, canEdit, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState(() => fromIdea(idea));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setForm(fromIdea(idea));
      setErrors({});
      setNotice(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, idea?.id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const save = async () => {
    const url = form.url.trim();
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = 'Give it a name';
    if (url && !/^https?:\/\/\S+$/i.test(url)) next.url = 'Links start with http:// or https://';
    if (Object.values(next).some(Boolean)) return setErrors(next);

    setBusy(true);
    const result = await onSave({
      title: form.title.trim(),
      type: form.type,
      note: form.note.trim() || null,
      url: url || null,
    });
    setBusy(false);

    if ('ok' in result) return onClose();
    if ('conflict' in result) {
      setForm(fromIdea(result.conflict));
      setNotice("Someone changed this while you were editing. You're now seeing the latest version.");
      return;
    }
    setNotice(result.error);
  };

  const confirmDelete = () =>
    Alert.alert('Remove this idea?', form.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await onDelete?.();
          onClose();
        },
      },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerText}>{canEdit ? 'Cancel' : 'Close'}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {idea ? (canEdit ? 'Edit idea' : 'Idea') : 'New idea'}
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
              label="What's the idea?"
              value={form.title}
              onChangeText={(v) => set('title', v)}
              placeholder="Day trip to Sintra"
              error={errors.title}
              editable={canEdit}
              autoFocus={!idea}
            />

            <View style={{ gap: space.sm }}>
              <Label>Type</Label>
              <View style={styles.chips}>
                {ITEM_TYPES.map((t) => {
                  const on = form.type === t;
                  return (
                    <Pressable
                      key={t}
                      accessibilityRole="radio"
                      aria-checked={on}
                      aria-disabled={!canEdit}
                      disabled={!canEdit}
                      onPress={() => set('type', t)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Feather name={ITEM_TYPE_META[t].icon} size={14} color={on ? '#FFFFFF' : colors.ink} />
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                        {ITEM_TYPE_META[t].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Field
              label="Why (optional)"
              value={form.note}
              onChangeText={(v) => set('note', v)}
              placeholder="Everyone says the palaces are worth the trek"
              multiline
              style={{ height: 96, paddingTop: 14, textAlignVertical: 'top' }}
              editable={canEdit}
            />

            <Field
              label="Link (optional)"
              value={form.url}
              onChangeText={(v) => set('url', v)}
              placeholder="https://..."
              autoCapitalize="none"
              keyboardType="url"
              error={errors.url}
              editable={canEdit}
            />

            {idea && canEdit && onDelete ? (
              <Button label="Remove idea" variant="ghost" onPress={confirmDelete} />
            ) : null}
          </ScrollView>

          {canEdit ? (
            <View style={styles.footer}>
              <Button label={idea ? 'Save changes' : 'Add idea'} onPress={save} loading={busy} />
            </View>
          ) : null}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
