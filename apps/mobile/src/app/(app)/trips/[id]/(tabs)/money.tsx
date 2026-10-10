import Feather from '@expo/vector-icons/Feather';
import {
  computeBalances,
  Expense,
  formatMoney,
  hasRole,
  newId,
  Settlement,
  suggestTransfers,
  TripMoney,
  type MoneyPerson,
  type SettlementMethod,
  type Transfer,
} from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpenseSheet, type ExpenseFields, type SaveResult } from '@/components/expense-sheet';
import { SettleSheet } from '@/components/settle-sheet';
import { Avatar, Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { CATEGORY_META, decodeDraft, exportCsv, nameOf, type ExpenseDraft } from '@/lib/money';
import { planDays, shortDate } from '@/lib/plan';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'expense'; key: string; expense: Expense }
  | { kind: 'settlement'; key: string; settlement: Settlement };

/** Newest first: expenses by their day, payments by when they were made. */
const buildRows = (expenses: Expense[], settlements: Settlement[]): Row[] => {
  const dated = [
    ...expenses.map((e) => ({ day: e.spentOn, at: e.createdAt, row: { kind: 'expense' as const, key: e.id, expense: e } })),
    ...settlements.map((s) => ({ day: s.settledAt.slice(0, 10), at: s.settledAt, row: { kind: 'settlement' as const, key: s.id, settlement: s } })),
  ].sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : a.at < b.at ? 1 : -1));
  const rows: Row[] = [];
  let lastDay = '';
  for (const d of dated) {
    if (d.day !== lastDay) {
      rows.push({ kind: 'day', key: `day-${d.day}`, label: shortDate(d.day) });
      lastDay = d.day;
    }
    rows.push(d.row);
  }
  return rows;
};

/** Upserts by id, keeping whichever copy is newer. */
const upsert = <T extends { id: string; version: number }>(list: T[], next: T) => {
  const i = list.findIndex((x) => x.id === next.id);
  if (i === -1) return [next, ...list];
  if (list[i]!.version > next.version) return list;
  const copy = [...list];
  copy[i] = next;
  return copy;
};

/** Split costs and settle up (design: Money in the canvas), live for everyone on the trip. */
export default function MoneyTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const [data, setData] = useState<TripMoney | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<{ expense?: Expense; draft?: ExpenseDraft | null } | null>(null);
  const [paying, setPaying] = useState<Transfer | null>(null);

  const tripId = trip?.id;
  const me = trip?.myUserId ?? '';
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setData(await request(`/trips/${tripId}/money`, { schema: TripMoney }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the money');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setExpenses = (fn: (list: Expense[]) => Expense[]) =>
    setData((d) => (d ? { ...d, expenses: fn(d.expenses) } : d));
  const setSettlements = (fn: (list: Settlement[]) => Settlement[]) =>
    setData((d) => (d ? { ...d, settlements: fn(d.settlements) } : d));

  useTripRealtime(tripId, (message) => {
    if (message.kind === 'reconnected') return void load();
    if (message.kind !== 'event') return;
    const { event } = message;
    if (event.type === 'expense.upserted') {
      const parsed = Expense.safeParse(event.payload);
      if (parsed.success) setExpenses((list) => upsert(list, parsed.data));
    } else if (event.type === 'expense.deleted') {
      setExpenses((list) => list.filter((e) => e.id !== event.entityId));
    } else if (event.type === 'settlement.upserted') {
      const parsed = Settlement.safeParse(event.payload);
      if (parsed.success) setSettlements((list) => upsert(list, parsed.data));
    } else if (event.type === 'settlement.deleted') {
      setSettlements((list) => list.filter((s) => s.id !== event.entityId));
    } else if (event.type.startsWith('member.')) {
      void reloadTrip();
      void load();
    }
  });

  // "Add as expense" from a booking, plan item or chat message lands here with ?expense=<draft>.
  // Each draft opens the sheet once, even if the param lingers while the screen re-renders.
  const { expense: draftParam } = useLocalSearchParams<{ expense?: string }>();
  const handledDraft = useRef<string>(undefined);
  useEffect(() => {
    if (!draftParam || draftParam === handledDraft.current || !canEdit || !data) return;
    handledDraft.current = draftParam;
    const draft = decodeDraft(draftParam);
    if (draft) setSheet({ draft });
    router.setParams({ expense: undefined });
  }, [draftParam, canEdit, data]);

  // Worked out here from the expenses and payments, so live changes show at once.
  const people: MoneyPerson[] = useMemo(() => {
    const known = new Map((data?.people ?? []).map((p) => [p.userId, p]));
    for (const m of trip?.members ?? []) {
      known.set(m.userId, { userId: m.userId, displayName: m.displayName, active: true });
    }
    return [...known.values()];
  }, [data?.people, trip?.members]);
  const balances = useMemo(() => {
    const net = computeBalances(data?.expenses ?? [], data?.settlements ?? []);
    for (const p of people) if (!net.has(p.userId)) net.set(p.userId, 0);
    return net;
  }, [data?.expenses, data?.settlements, people]);
  const suggested = useMemo(() => suggestTransfers(balances), [balances]);
  const rows = useMemo(() => buildRows(data?.expenses ?? [], data?.settlements ?? []), [data?.expenses, data?.settlements]);
  const days = useMemo(() => (trip ? planDays(trip.startDate, trip.endDate, []) : []), [trip]);

  if (!trip) return null;
  const base = data?.baseCurrency ?? trip.baseCurrency;
  const money = (minor: number) => formatMoney(minor, base);
  const name = (userId: string) => nameOf(people, userId, me);

  const myNet = balances.get(me) ?? 0;
  const total = (data?.expenses ?? []).reduce((sum, e) => sum + e.baseAmountMinor, 0);
  const myShare = (data?.expenses ?? []).reduce(
    (sum, e) => sum + (e.splits.find((s) => s.userId === me)?.shareMinor ?? 0),
    0,
  );

  const saveExpense = async (fields: ExpenseFields): Promise<SaveResult> => {
    const editing = sheet?.expense;
    try {
      const saved = editing
        ? await request(`/expenses/${editing.id}`, {
            method: 'PATCH',
            body: { ...fields, version: editing.version },
            schema: Expense,
          })
        : await request(`/trips/${trip.id}/expenses`, {
            method: 'POST',
            body: { ...fields, id: newId() },
            schema: Expense,
          });
      setExpenses((list) => upsert(list, saved));
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const latest = Expense.safeParse(e.data.current);
        if (latest.success) {
          setExpenses((list) => upsert(list, latest.data));
          setSheet({ expense: latest.data });
          return { conflict: latest.data };
        }
      }
      return {
        error: e instanceof ApiError ? e.message : 'Could not save that',
        code: e instanceof ApiError ? e.code : undefined,
      };
    }
  };

  const deleteExpense = async () => {
    const target = sheet?.expense;
    if (!target) return;
    setExpenses((list) => list.filter((e) => e.id !== target.id));
    await request(`/expenses/${target.id}`, { method: 'DELETE' }).catch(() => void load());
  };

  const recordPayment = async (payment: Transfer & { method: SettlementMethod }) => {
    try {
      const saved = await request(`/trips/${trip.id}/settlements`, {
        method: 'POST',
        body: { ...payment, id: newId() },
        schema: Settlement,
      });
      setSettlements((list) => upsert(list, saved));
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Could not record that';
    }
  };

  const canSettle = (t: { fromUser: string; toUser: string }) => canEdit || t.fromUser === me || t.toUser === me;

  const undoPayment = (s: Settlement) => {
    if (!canSettle(s)) return;
    Alert.alert('Undo this payment?', `${name(s.fromUser)} paid ${name(s.toUser)} ${money(s.amountMinor)}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          setSettlements((list) => list.filter((x) => x.id !== s.id));
          await request(`/settlements/${s.id}`, { method: 'DELETE' }).catch(() => void load());
        },
      },
    ]);
  };

  const headline =
    myNet > 0 ? `You’re owed ${money(myNet)}` : myNet < 0 ? `You owe ${money(-myNet)}` : 'You’re all square';
  const sheetPeople = sheet?.expense
    ? [
        ...people,
        ...sheet.expense.splits
          .filter((s) => !people.some((p) => p.userId === s.userId))
          .map((s) => ({ userId: s.userId, displayName: 'Someone', active: false })),
      ]
    : people;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Title>Money</Title>
        {data && data.expenses.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export expenses as a spreadsheet"
            onPress={() => void exportCsv(trip.name, data.expenses, people, base)}
            style={styles.iconButton}
          >
            <Feather name="download" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <View style={styles.center}>
          <Body>{error}</Body>
          <Button label="Try again" variant="outline" onPress={load} />
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.hero} accessibilityRole="summary">
            <Text style={styles.heroLabel}>Your balance</Text>
            <Text style={styles.heroAmount}>{headline}</Text>
            <Text style={styles.heroSub}>
              Trip spend {money(total)} · Your share {money(myShare)}
            </Text>
          </View>

          {suggested.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>Settle up</Label>
              <View style={styles.card}>
                {suggested.map((t, i) => (
                  <View key={`${t.fromUser}-${t.toUser}`} style={[styles.transfer, i > 0 && styles.divider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.transferText}>
                        {name(t.fromUser)} <Text style={{ color: colors.muted }}>{t.fromUser === me ? 'pay' : 'pays'}</Text>{' '}
                        {t.toUser === me ? 'you' : name(t.toUser)}
                      </Text>
                      <Text style={styles.transferAmount}>{money(t.amountMinor)}</Text>
                    </View>
                    {canSettle(t) ? (
                      <Button
                        label="Mark paid"
                        variant={t.fromUser === me || t.toUser === me ? 'primary' : 'outline'}
                        onPress={() => setPaying(t)}
                        style={{ minHeight: 44, paddingHorizontal: space.md }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
              <Body style={{ fontSize: 13 }}>The fewest payments that square everyone up.</Body>
            </View>
          ) : data.expenses.length > 0 ? (
            <View style={styles.square}>
              <Feather name="check-circle" size={18} color={colors.accent} />
              <Body style={{ flex: 1 }}>Everyone’s square. Nothing to settle.</Body>
            </View>
          ) : null}

          <View style={{ gap: space.sm }}>
            <Label>Balances</Label>
            <View style={styles.card}>
              {people.map((p, i) => {
                const net = balances.get(p.userId) ?? 0;
                return (
                  <View key={p.userId} style={[styles.balance, i > 0 && styles.divider]}>
                    <Avatar name={p.displayName} color={avatarColor(i)} />
                    <Text style={styles.balanceName}>
                      {p.userId === me ? 'You' : p.displayName}
                      {p.active ? '' : ' (left)'}
                    </Text>
                    <Text style={[styles.balanceAmount, { color: net > 0 ? colors.accent : net < 0 ? colors.coralInk : colors.muted }]}>
                      {net > 0
                        ? `${p.userId === me ? 'get' : 'gets'} back ${money(net)}`
                        : net < 0
                          ? `${p.userId === me ? 'owe' : 'owes'} ${money(-net)}`
                          : 'square'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>Expenses</Label>
            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="credit-card" size={28} color={colors.accent} />
                <Body style={{ textAlign: 'center' }}>
                  Log what you pay for the group: dinners, taxis, tickets. Tagalong keeps track of who owes whom.
                </Body>
                {canEdit ? <Button label="Add the first expense" variant="outline" onPress={() => setSheet({})} /> : null}
              </View>
            ) : (
              rows.map((row) => {
                if (row.kind === 'day') {
                  return (
                    <Text key={row.key} style={styles.day}>
                      {row.label}
                    </Text>
                  );
                }
                if (row.kind === 'settlement') {
                  const s = row.settlement;
                  return (
                    <Pressable
                      key={row.key}
                      accessibilityRole="button"
                      accessibilityHint={canSettle(s) ? 'Double tap to undo' : undefined}
                      onPress={() => undoPayment(s)}
                      style={styles.paymentRow}
                    >
                      <Feather name="repeat" size={16} color={colors.accent} />
                      <Text style={styles.paymentText}>
                        {name(s.fromUser)} paid {s.toUser === me ? 'you' : name(s.toUser)} {money(s.amountMinor)}
                      </Text>
                    </Pressable>
                  );
                }
                const e = row.expense;
                const mine = e.splits.find((s) => s.userId === me)?.shareMinor ?? 0;
                const lent = e.paidBy === me ? e.baseAmountMinor - mine : 0;
                const note =
                  e.paidBy === me
                    ? lent > 0
                      ? `You paid · you lent ${money(lent)}`
                      : 'You paid'
                    : mine > 0
                      ? `${name(e.paidBy)} paid · your share ${money(mine)}`
                      : `${name(e.paidBy)} paid · not shared with you`;
                return (
                  <Pressable
                    key={row.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${e.description}, ${formatMoney(e.amountMinor, e.currency)}. ${note}`}
                    onPress={() => setSheet({ expense: e })}
                    style={styles.expense}
                  >
                    <View style={styles.categoryIcon}>
                      <Feather name={CATEGORY_META[e.category].icon} size={16} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.expenseTitle} numberOfLines={1}>
                        {e.description}
                      </Text>
                      <Body style={{ fontSize: 13 }} numberOfLines={1}>
                        {note}
                      </Body>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.expenseAmount}>{formatMoney(e.amountMinor, e.currency)}</Text>
                      {e.currency !== base ? <Text style={styles.converted}>{money(e.baseAmountMinor)}</Text> : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      {canEdit && data && rows.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add expense" onPress={() => setSheet({})} style={styles.fab}>
          <Feather name="plus" size={26} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <ExpenseSheet
        visible={!!sheet}
        expense={sheet?.expense}
        draft={sheet?.draft}
        people={sheetPeople}
        me={me}
        baseCurrency={base}
        days={days}
        canEdit={canEdit}
        onSave={saveExpense}
        onDelete={deleteExpense}
        onClose={() => setSheet(null)}
      />
      <SettleSheet
        transfer={paying}
        currency={base}
        nameOf={name}
        onSave={recordPayment}
        onClose={() => setPaying(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.md },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, paddingTop: space.md, paddingBottom: 120, gap: space.xl },
  hero: { backgroundColor: colors.accent, borderRadius: radius.xl, padding: space.xl, gap: 4 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onAccentMuted },
  heroAmount: { fontFamily: fonts.display, fontSize: 28, color: '#FFFFFF' },
  heroSub: { fontFamily: fonts.medium, fontSize: 13, color: colors.onAccentMuted, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  transfer: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg },
  transferText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  transferAmount: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, marginTop: 2 },
  square: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  balance: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg },
  balanceName: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  balanceAmount: { fontFamily: fonts.bold, fontSize: 14 },
  day: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted, marginTop: space.sm },
  expense: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  categoryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  expenseTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  expenseAmount: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  converted: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md },
  paymentText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 32, paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  fab: { position: 'absolute', right: space.xl, bottom: space.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
