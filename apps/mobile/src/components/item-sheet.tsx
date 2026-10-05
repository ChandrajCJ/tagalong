import Feather from '@expo/vector-icons/Feather';
import { ITEM_TYPES, type ItemType, type ItineraryItem } from '@tagalong/shared';
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
import {
  ANYTIME,
  dateOfKey,
  dayKeyOf,
  ITEM_TYPE_META,
  shortDate,
  type DayKey,
} from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

/** The fields the sheet edits, in the shape the API takes. */
export interface ItemFields {
  title: string;
  type: ItemType;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  placeName: string | null;
  notes: string | null;
  costEstimateMinor: number | null;
  costCurrency: string | null;
}

export type SaveResult = { ok: true } | { conflict: ItineraryItem } | { error: string };

interface Props {
  visible: boolean;
  /** The item being edited, or undefined to add a new one. */
  item?: ItineraryItem;
  /** Where a new item goes. */
  defaultDay: DayKey;
  /** Prefills a new item's title, e.g. from a chat message. */
  draftTitle?: string;
  days: DayKey[];
  currency: string;
  canEdit: boolean;
  onSave: (fields: ItemFields) => Promise<SaveResult>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

/** "9:30" → "09:30"; "1830" → "18:30". Anything else is returned as typed. */
const normalizeTime = (value: string) => {
  const v = value.trim();
  const m = v.match(/^(\d{1,2}):?(\d{2})$/);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : v;
};
const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const fromItem = (item: ItineraryItem | undefined, defaultDay: DayKey, draftTitle = '') => ({
  title: item?.title ?? draftTitle,
  type: item?.type ?? ('activity' as ItemType),
  day: item ? dayKeyOf(item) : defaultDay,
  startTime: item?.startTime ?? '',
  endTime: item?.endTime ?? '',
  placeName: item?.placeName ?? '',
  notes: item?.notes ?? '',
  cost: item?.costEstimateMinor != null ? String(item.costEstimateMinor / 100) : '',
});

export function ItemSheet(props: Props) {
  const { visible, item, defaultDay, draftTitle, days, currency, canEdit, onSave, onDelete, onClose } =
    props;
  const [form, setForm] = useState(() => fromItem(item, defaultDay, draftTitle));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setForm(fromItem(item, defaultDay, draftTitle));
      setErrors({});
      setNotice(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const save = async () => {
    const startTime = normalizeTime(form.startTime);
    const endTime = normalizeTime(form.endTime);
    const cost = form.cost.trim().replace(',', '.');
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = 'Give it a name';
    if (startTime && !validTime(startTime)) next.startTime = 'Use a time like 09:30';
    if (endTime && !validTime(endTime)) next.endTime = 'Use a time like 18:00';
    if (cost && (Number.isNaN(Number(cost)) || Number(cost) < 0)) next.cost = 'Enter an amount like 25 or 12.50';
    if (Object.values(next).some(Boolean)) return setErrors(next);

    setBusy(true);
    const result = await onSave({
      title: form.title.trim(),
      type: form.type,
      date: dateOfKey(form.day),
      startTime: startTime || null,
      endTime: endTime || null,
      placeName: form.placeName.trim() || null,
      notes: form.notes.trim() || null,
      costEstimateMinor: cost ? Math.round(Number(cost) * 100) : null,
      costCurrency: cost ? currency : null,
    });
    setBusy(false);

    if ('ok' in result) return onClose();
    if ('conflict' in result) {
      // Someone saved first: show their version so nothing is silently lost.
      setForm(fromItem(result.conflict, defaultDay));
      setNotice('Someone changed this while you were editing. You\'re now seeing the latest version.');
      return;
    }
    setNotice(result.error);
  };

  const confirmDelete = () =>
    Alert.alert('Delete this from the plan?', form.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await onDelete?.();
          onClose();
        },
      },
    ]);

  const dayOptions: DayKey[] = [ANYTIME, ...days];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerText}>{canEdit ? 'Cancel' : 'Close'}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {item ? (canEdit ? 'Edit' : 'Details') : 'Add to plan'}
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
              label="What"
              value={form.title}
              onChangeText={(v) => set('title', v)}
              placeholder="Lunch at Time Out Market"
              error={errors.title}
              editable={canEdit}
              autoFocus={!item}
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
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{ITEM_TYPE_META[t].label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Starts"
                  value={form.startTime}
                  onChangeText={(v) => set('startTime', v)}
                  onBlur={() => set('startTime', normalizeTime(form.startTime))}
                  placeholder="09:30"
                  keyboardType="numbers-and-punctuation"
                  error={errors.startTime}
                  editable={canEdit}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Ends"
                  value={form.endTime}
                  onChangeText={(v) => set('endTime', v)}
                  onBlur={() => set('endTime', normalizeTime(form.endTime))}
                  placeholder="11:00"
                  keyboardType="numbers-and-punctuation"
                  error={errors.endTime}
                  editable={canEdit}
                />
              </View>
            </View>

            <Field
              label="Where"
              value={form.placeName}
              onChangeText={(v) => set('placeName', v)}
              placeholder="Rua dos Remédios 12, Alfama"
              editable={canEdit}
            />

            <Field
              label={`Cost per person (${currency}, optional)`}
              value={form.cost}
              onChangeText={(v) => set('cost', v)}
              placeholder="25"
              keyboardType="decimal-pad"
              error={errors.cost}
              editable={canEdit}
            />

            <Field
              label="Notes"
              value={form.notes}
              onChangeText={(v) => set('notes', v)}
              placeholder="Book ahead. Ask for the terrace."
              multiline
              style={{ height: 96, paddingTop: 14, textAlignVertical: 'top' }}
              editable={canEdit}
            />

            <View style={{ gap: space.sm }}>
              <Label>Day</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {dayOptions.map((d) => {
                  const on = form.day === d;
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="radio"
                      aria-checked={on}
                      aria-disabled={!canEdit}
                      disabled={!canEdit}
                      onPress={() => set('day', d)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                        {d === ANYTIME ? 'Anytime' : shortDate(d)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {item && canEdit && onDelete ? (
              <Button label="Delete from plan" variant="ghost" onPress={confirmDelete} />
            ) : null}
          </ScrollView>

          {canEdit ? (
            <View style={styles.footer}>
              <Button label={item ? 'Save changes' : 'Add to plan'} onPress={save} loading={busy} />
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
  row: { flexDirection: 'row', gap: space.md },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
