import {
  amountText,
  EXPENSE_CATEGORIES,
  parseAmount,
  SetBudgetInput,
  type Budget,
  type BudgetCategories,
  type BudgetMode,
} from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORY_META } from '@/lib/money';
import { confirmAction } from '@/lib/confirm';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

export const BUDGET_MODE_LABELS: Record<BudgetMode, string> = { group: 'Group', per_person: 'Each person' };

interface Props {
  visible: boolean;
  /** The budget to change, or null to add one. */
  budget: Budget | null;
  currency: string;
  onSave: (input: SetBudgetInput) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
  onClose: () => void;
}

/** Add or change the trip's budget: a total, category limits, or both. Every part is optional. */
export function BudgetSheet({ visible, budget, currency, onSave, onRemove, onClose }: Props) {
  const [mode, setMode] = useState<BudgetMode>('group');
  const [total, setTotal] = useState('');
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMode(budget?.mode ?? 'group');
    setTotal(budget?.totalMinor ? amountText(budget.totalMinor, currency) : '');
    setLimits(
      Object.fromEntries(Object.entries(budget?.categories ?? {}).map(([c, minor]) => [c, amountText(minor!, currency)])),
    );
    setError(undefined);
  }, [visible, budget, currency]);

  if (!visible) return null;

  const save = async () => {
    const totalMinor = total.trim() ? parseAmount(total, currency) : null;
    if (total.trim() && !totalMinor) return setError(`Enter the total like ${amountText(250000, currency)}`);
    const categories: BudgetCategories = {};
    for (const c of EXPENSE_CATEGORIES) {
      const text = limits[c]?.trim();
      if (!text) continue;
      const minor = parseAmount(text, currency);
      if (!minor) return setError(`Enter the ${CATEGORY_META[c].label.toLowerCase()} limit like ${amountText(50000, currency)}`);
      categories[c] = minor;
    }
    const parsed = SetBudgetInput.safeParse({ mode, totalMinor, categories, version: budget?.version });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the amounts');
    setBusy(true);
    const problem = await onSave(parsed.data);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  const remove = async () => {
    if (!(await confirmAction('Remove the budget?', 'Expenses stay as they are. The trip just stops tracking a budget.', 'Remove'))) return;
    setBusy(true);
    const problem = await onRemove();
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  const each = mode === 'per_person';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
            <View style={styles.grabber} />
            <Text accessibilityRole="header" style={styles.title}>
              {budget ? 'Budget' : 'Add a budget'}
            </Text>
            <Body style={{ fontSize: 13 }}>
              Optional. Set a total, limits for some categories, or both. Spending shows against it on the Money tab.
            </Body>

            <View style={{ gap: space.sm }}>
              <Label>Who it’s for</Label>
              <View style={styles.chips}>
                {(['group', 'per_person'] as const).map((m) => {
                  const on = mode === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => setMode(m)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && { color: colors.onFill }]}>{BUDGET_MODE_LABELS[m]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Body style={{ fontSize: 12 }}>
                {each
                  ? 'Amounts are per person. Each of you sees your own share of the spending against them.'
                  : 'Amounts are for the whole group.'}
              </Body>
            </View>

            <Field
              label={`Total${each ? ' each' : ''} (${currency}, optional)`}
              value={total}
              onChangeText={setTotal}
              keyboardType="decimal-pad"
              placeholder="No total"
            />

            <View style={{ gap: space.sm }}>
              <Label>Category limits (optional)</Label>
              <View style={styles.limits}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <View key={c} style={styles.limit}>
                    <Field
                      label={CATEGORY_META[c].label}
                      value={limits[c] ?? ''}
                      onChangeText={(text) => setLimits((l) => ({ ...l, [c]: text }))}
                      keyboardType="decimal-pad"
                      placeholder="No limit"
                    />
                  </View>
                ))}
              </View>
            </View>

            {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
            <Button label={budget ? 'Save budget' : 'Add budget'} onPress={save} loading={busy} />
            {budget ? <Button label="Remove budget" variant="ghost" onPress={() => void remove()} disabled={busy} /> : null}
            <Button label="Cancel" variant="outline" onPress={onClose} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { maxHeight: '90%', backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  limits: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  limit: { flexBasis: '46%', flexGrow: 1 },
});
