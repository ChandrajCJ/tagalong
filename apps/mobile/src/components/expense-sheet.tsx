import Feather from '@expo/vector-icons/Feather';
import {
  amountText,
  convertMinor,
  EXPENSE_CATEGORIES,
  formatMoney,
  FxQuote,
  parseAmount,
  SPLIT_METHODS,
  splitExpense,
  type Expense,
  type ExpenseCategory,
  type MoneyPerson,
  type SplitMethod,
} from '@tagalong/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { request } from '@/lib/api';
import { todayIso } from '@/lib/dates';
import { CATEGORY_META, SPLIT_LABELS, type ExpenseDraft } from '@/lib/money';
import { shortDate } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

/** What the sheet produces, in the shape the API takes. */
export interface ExpenseFields {
  paidBy: string;
  description: string;
  category: ExpenseCategory;
  amountMinor: number;
  currency: string;
  /** Sent only when someone typed a rate, so the server otherwise uses today's. */
  fxRate?: number;
  spentOn: string;
  splitMethod: SplitMethod;
  splits: { userId: string; value: number }[];
  itemId?: string | null;
  bookingId?: string | null;
  sourceMessageId?: string | null;
}

export type SaveResult = { ok: true } | { conflict: Expense } | { error: string; code?: string };

interface Props {
  visible: boolean;
  expense?: Expense;
  /** Prefill for a new expense, from a booking, plan item or chat message. */
  draft?: ExpenseDraft | null;
  /** Who can pay or share: everyone on the trip, plus anyone already on this expense. */
  people: MoneyPerson[];
  me: string;
  baseCurrency: string;
  /** The trip's dates, for picking the day. */
  days: string[];
  canEdit: boolean;
  onSave: (fields: ExpenseFields) => Promise<SaveResult>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

const defaultDay = (days: string[]) => {
  const today = todayIso();
  return days.length === 0 || days.includes(today) ? today : today > days.at(-1)! ? days.at(-1)! : days[0]!;
};

/** What each split method's per-person box holds, as text. */
const valueText = (method: SplitMethod, value: number, currency: string) =>
  method === 'exact' ? amountText(value, currency) : method === 'percent' ? String(value / 100) : String(value);

const initial = (
  expense: Expense | undefined,
  draft: ExpenseDraft | null | undefined,
  people: MoneyPerson[],
  me: string,
  base: string,
  days: string[],
) => {
  const currency = expense?.currency ?? draft?.currency ?? base;
  const method = expense?.splitMethod ?? 'equal';
  const values: Record<string, string> = {};
  for (const s of expense?.splits ?? []) values[s.userId] = valueText(method, s.value, currency);
  const amountMinor = expense?.amountMinor ?? draft?.amountMinor;
  return {
    description: expense?.description ?? draft?.description ?? '',
    amount: amountMinor ? amountText(amountMinor, currency) : '',
    currency,
    rate: expense && expense.currency !== base ? String(expense.fxRate) : '',
    rateTouched: false,
    paidBy: expense?.paidBy ?? me,
    category: expense?.category ?? draft?.category ?? ('food' as ExpenseCategory),
    spentOn: expense?.spentOn ?? draft?.spentOn ?? defaultDay(days),
    method,
    included: new Set(expense ? expense.splits.map((s) => s.userId) : people.filter((p) => p.active).map((p) => p.userId)),
    values,
  };
};

/** Add or edit an expense: what, how much, who paid, and how it's split. */
export function ExpenseSheet({
  visible,
  expense,
  draft,
  people,
  me,
  baseCurrency,
  days,
  canEdit,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [form, setForm] = useState(() => initial(expense, draft, people, me, baseCurrency, days));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [rateNote, setRateNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setForm(initial(expense, draft, people, me, baseCurrency, days));
    setErrors({});
    setNotice(undefined);
    setRateNote(undefined);
    // Only when the sheet opens, or switches to a different expense.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expense?.id]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const currency = form.currency.trim().toUpperCase();
  const foreign = currency.length === 3 && currency !== baseCurrency;

  // A foreign currency fills in today's rate, unless someone typed their own.
  useEffect(() => {
    if (!visible || !foreign || form.rateTouched) return;
    if (expense && expense.currency === currency) return;
    let live = true;
    setRateNote('Looking up today’s rate…');
    request(`/fx?from=${currency}&to=${baseCurrency}`, { schema: FxQuote })
      .then((q) => {
        if (!live) return;
        setForm((f) => (f.rateTouched ? f : { ...f, rate: String(q.rate) }));
        setRateNote(`Today’s rate, from the European Central Bank (${q.date}). Change it to match your bank.`);
      })
      .catch(() => {
        if (!live) return;
        setForm((f) => (f.rateTouched ? f : { ...f, rate: '' }));
        setRateNote(`There’s no published rate for ${currency}. Enter what 1 ${currency} was in ${baseCurrency}.`);
      });
    return () => {
      live = false;
    };
  }, [visible, foreign, currency, baseCurrency, form.rateTouched, expense]);

  const amountMinor = currency.length === 3 ? parseAmount(form.amount, currency) : null;
  const rate = foreign ? Number(form.rate.replace(',', '.')) : 1;
  const rateOk = !foreign || (Number.isFinite(rate) && rate > 0);
  const baseMinor = amountMinor && rateOk ? convertMinor(amountMinor, currency, baseCurrency, rate) : null;

  const entries = useMemo(() => {
    if (form.method === 'equal') return [...form.included].map((userId) => ({ userId, value: 0 }));
    return people
      .map((p) => {
        const text = form.values[p.userId]?.trim() ?? '';
        if (!text) return null;
        const value =
          form.method === 'exact'
            ? parseAmount(text, currency)
            : form.method === 'percent'
              ? Math.round(Number(text.replace(',', '.')) * 100)
              : Number(text);
        return { userId: p.userId, value: value === null || Number.isNaN(value) ? -1 : value };
      })
      .filter((e): e is { userId: string; value: number } => !!e && e.value !== 0);
  }, [form.method, form.included, form.values, people, currency]);

  const split = amountMinor && baseMinor !== null ? splitExpense(form.method, entries, amountMinor, baseMinor) : null;
  const shareOf = new Map(split?.ok ? split.shares.map((s) => [s.userId, s.shareMinor]) : []);

  /** What's still to assign, for amounts and percent. */
  const remaining = (() => {
    if (!amountMinor) return null;
    const total = entries.reduce((sum, e) => sum + Math.max(e.value, 0), 0);
    if (form.method === 'exact') {
      const left = amountMinor - total;
      return left === 0 ? null : left > 0 ? `${formatMoney(left, currency)} left to assign` : `${formatMoney(-left, currency)} too much`;
    }
    if (form.method === 'percent') {
      const left = 10_000 - total;
      return left === 0 ? null : left > 0 ? `${left / 100}% left to assign` : `${-left / 100}% too much`;
    }
    return null;
  })();

  const save = async () => {
    const next: Record<string, string> = {};
    if (!form.description.trim()) next.description = 'Say what it was for';
    if (currency.length !== 3) next.currency = 'Use a 3-letter code';
    else if (!amountMinor) next.amount = `Enter an amount like ${amountText(1250, currency)}`;
    if (foreign && !rateOk) next.rate = 'Enter the rate';
    if (amountMinor && split && !split.ok) next.split = split.error;
    setErrors(next);
    if (Object.keys(next).length > 0 || !amountMinor) return;

    setBusy(true);
    setNotice(undefined);
    const result = await onSave({
      paidBy: form.paidBy,
      description: form.description.trim(),
      category: form.category,
      amountMinor,
      currency,
      ...(foreign && form.rateTouched ? { fxRate: rate } : {}),
      spentOn: form.spentOn,
      splitMethod: form.method,
      splits: entries,
      ...(expense
        ? {}
        : {
            itemId: draft?.itemId ?? null,
            bookingId: draft?.bookingId ?? null,
            sourceMessageId: draft?.sourceMessageId ?? null,
          }),
    });
    setBusy(false);
    if ('ok' in result) return onClose();
    if ('conflict' in result) {
      setForm(initial(result.conflict, null, people, me, baseCurrency, days));
      setNotice('Someone changed this while you were editing. You’re now seeing the latest version.');
      return;
    }
    if (result.code === 'rate_needed') {
      setErrors({ rate: 'Enter the rate' });
      set('rateTouched', true);
    }
    setNotice(result.error);
  };

  const confirmDelete = () =>
    Alert.alert('Delete this expense?', 'Everyone’s balances will be worked out without it.', [
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

  const toggle = (userId: string) =>
    setForm((f) => {
      const included = new Set(f.included);
      if (included.has(userId)) included.delete(userId);
      else included.add(userId);
      return { ...f, included };
    });

  const switchMethod = (method: SplitMethod) =>
    setForm((f) => {
      // Start shares at 1 each for whoever was included, so it's a tweak, not a blank form.
      const values: Record<string, string> = {};
      if (method === 'shares') for (const id of f.included) values[id] = '1';
      return { ...f, method, values };
    });

  const dayOptions = [...new Set([...days, form.spentOn, todayIso()])].sort();
  const name = (p: MoneyPerson) => (p.userId === me ? 'You' : p.displayName);
  const editable = canEdit;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.headerButton}>
              <Text style={styles.headerText}>{editable ? 'Cancel' : 'Close'}</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {expense ? (editable ? 'Edit expense' : 'Expense') : 'Add expense'}
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
              label="What for"
              value={form.description}
              onChangeText={(v) => set('description', v)}
              placeholder="Dinner at Time Out Market"
              error={errors.description}
              editable={editable}
              autoFocus={!expense && !draft?.description}
              maxLength={120}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Amount"
                  value={form.amount}
                  onChangeText={(v) => set('amount', v)}
                  placeholder={amountText(4500, currency.length === 3 ? currency : baseCurrency)}
                  keyboardType="decimal-pad"
                  error={errors.amount}
                  editable={editable}
                />
              </View>
              <View style={{ width: 96 }}>
                <Field
                  label="Currency"
                  value={form.currency}
                  onChangeText={(v) => setForm((f) => ({ ...f, currency: v.toUpperCase(), rateTouched: false }))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={3}
                  error={errors.currency}
                  editable={editable}
                />
              </View>
            </View>

            {foreign ? (
              <View style={{ gap: 6 }}>
                <Field
                  label={`1 ${currency} in ${baseCurrency}`}
                  value={form.rate}
                  onChangeText={(v) => setForm((f) => ({ ...f, rate: v, rateTouched: true }))}
                  keyboardType="decimal-pad"
                  placeholder="0.92"
                  error={errors.rate}
                  editable={editable}
                />
                {rateNote && !form.rateTouched ? <Text style={styles.hint}>{rateNote}</Text> : null}
                {baseMinor !== null ? (
                  <Text style={styles.converted}>
                    = {formatMoney(baseMinor, baseCurrency)} in the trip’s currency
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Label>Paid by</Label>
              <View style={styles.chips}>
                {people
                  .filter((p) => p.active || p.userId === form.paidBy)
                  .map((p) => {
                    const on = form.paidBy === p.userId;
                    return (
                      <Pressable
                        key={p.userId}
                        accessibilityRole="radio"
                        aria-checked={on}
                        disabled={!editable}
                        onPress={() => set('paidBy', p.userId)}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{name(p)}</Text>
                      </Pressable>
                    );
                  })}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Label>Split</Label>
              <View style={styles.segments} accessibilityRole="tablist">
                {SPLIT_METHODS.map((m) => {
                  const on = form.method === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="tab"
                      aria-selected={on}
                      disabled={!editable}
                      onPress={() => switchMethod(m)}
                      style={[styles.segment, on && styles.segmentOn]}
                    >
                      <Text style={[styles.segmentText, on && { color: colors.ink }]}>{SPLIT_LABELS[m]}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.people}>
                {people
                  .filter((p) => p.active || form.included.has(p.userId) || form.values[p.userId])
                  .map((p, i) => {
                    const share = shareOf.get(p.userId);
                    return (
                      <View key={p.userId} style={[styles.personRow, i > 0 && styles.divider]}>
                        {form.method === 'equal' ? (
                          <Pressable
                            accessibilityRole="checkbox"
                            aria-checked={form.included.has(p.userId)}
                            accessibilityLabel={name(p)}
                            disabled={!editable}
                            onPress={() => toggle(p.userId)}
                            style={styles.check}
                          >
                            <Feather
                              name={form.included.has(p.userId) ? 'check-square' : 'square'}
                              size={20}
                              color={form.included.has(p.userId) ? colors.accent : colors.lineStrong}
                            />
                            <Text style={styles.personName}>{name(p)}</Text>
                          </Pressable>
                        ) : (
                          <>
                            <Text style={[styles.personName, { flex: 1 }]}>{name(p)}</Text>
                            <TextInput
                              accessibilityLabel={`${name(p)}: ${SPLIT_LABELS[form.method]}`}
                              value={form.values[p.userId] ?? ''}
                              onChangeText={(v) => set('values', { ...form.values, [p.userId]: v })}
                              keyboardType={form.method === 'shares' ? 'number-pad' : 'decimal-pad'}
                              placeholder="0"
                              placeholderTextColor="#8C867B"
                              editable={editable}
                              style={styles.valueInput}
                            />
                            <Text style={styles.unit}>
                              {form.method === 'percent' ? '%' : form.method === 'shares' ? '×' : currency}
                            </Text>
                          </>
                        )}
                        <Text style={styles.share}>
                          {share !== undefined ? formatMoney(share, baseCurrency) : ''}
                        </Text>
                      </View>
                    );
                  })}
              </View>
              {remaining ? <Text style={styles.hint}>{remaining}</Text> : null}
              {errors.split ? <Text style={styles.error}>{errors.split}</Text> : null}
            </View>

            <View style={{ gap: space.sm }}>
              <Label>Category</Label>
              <View style={styles.chips}>
                {EXPENSE_CATEGORIES.map((c) => {
                  const on = form.category === c;
                  return (
                    <Pressable
                      key={c}
                      accessibilityRole="radio"
                      aria-checked={on}
                      disabled={!editable}
                      onPress={() => set('category', c)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Feather name={CATEGORY_META[c].icon} size={14} color={on ? '#FFFFFF' : colors.ink} />
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{CATEGORY_META[c].label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Label>Day</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {dayOptions.map((d) => {
                  const on = form.spentOn === d;
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="radio"
                      aria-checked={on}
                      disabled={!editable}
                      onPress={() => set('spentOn', d)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                        {d === todayIso() ? 'Today' : shortDate(d)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {expense && editable && onDelete ? (
              <Button label="Delete expense" variant="ghost" onPress={confirmDelete} />
            ) : null}
          </ScrollView>

          {editable ? (
            <View style={styles.footer}>
              <Button label={expense ? 'Save changes' : 'Add expense'} onPress={save} loading={busy} />
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
  body: { padding: space.xl, gap: space.lg, paddingBottom: 40 },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  segments: { flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: '#ECE7DF' },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  segmentOn: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  people: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.md },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  check: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  personName: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  valueInput: { width: 76, minHeight: 40, paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bg, fontFamily: fonts.medium, fontSize: 15, color: colors.ink, textAlign: 'right' },
  unit: { width: 36, fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  share: { minWidth: 72, textAlign: 'right', fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
  converted: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
