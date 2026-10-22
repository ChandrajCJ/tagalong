import Feather from '@expo/vector-icons/Feather';
import { amountText, parseAmount, type BudgetMode } from '@tagalong/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, space } from '@/theme';
import { BUDGET_MODE_LABELS } from './budget-sheet';
import { Body, Field } from './ui';

export interface BudgetDraft {
  mode: BudgetMode;
  /** As typed; empty means no total. */
  total: string;
}

export const emptyBudgetDraft: BudgetDraft = { mode: 'group', total: '' };

/** The total in minor units, null when empty, or a problem to show. */
export const readBudgetDraft = (draft: BudgetDraft, currency: string): number | null | { error: string } => {
  if (!draft.total.trim()) return null;
  return parseAmount(draft.total, currency) || { error: `Enter the budget like ${amountText(250000, currency)}` };
};

interface Props {
  value: BudgetDraft;
  onChange: (draft: BudgetDraft) => void;
  currency: string;
  error?: string;
  /** Start open, e.g. on Edit trip when there's already a budget. */
  open?: boolean;
  /** Under the field: what else there is to know. */
  hint?: string;
}

/** New trip and Edit trip's collapsed "Budget (optional)" row: a total, for the group or each person. */
export function BudgetField({ value, onChange, currency, error, open: startOpen, hint }: Props) {
  const [open, setOpen] = useState(!!startOpen);
  if (!open) {
    return (
      <Pressable accessibilityRole="button" accessibilityHint="Shows the budget fields" onPress={() => setOpen(true)} style={styles.collapsed}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Budget (optional)</Text>
          <Body style={{ fontSize: 12 }}>Most trips don’t need one. You can add it later on the Money tab.</Body>
        </View>
        <Feather name="chevron-down" size={18} color={colors.faint} />
      </Pressable>
    );
  }
  const each = value.mode === 'per_person';
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.title}>Budget (optional)</Text>
      <View style={styles.chips}>
        {(['group', 'per_person'] as const).map((m) => {
          const on = value.mode === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="radio"
              aria-checked={on}
              onPress={() => onChange({ ...value, mode: m })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && { color: colors.onFill }]}>{BUDGET_MODE_LABELS[m]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        label={`Total${each ? ' each' : ''} (${currency})`}
        value={value.total}
        onChangeText={(total) => onChange({ ...value, total })}
        keyboardType="decimal-pad"
        placeholder="Leave empty for no budget"
        error={error}
      />
      <Body style={{ fontSize: 12 }}>
        {hint ?? 'Leave it empty for no budget. Limits per category are on the Money tab.'}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
});
