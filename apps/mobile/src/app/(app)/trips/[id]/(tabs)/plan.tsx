import Feather from '@expo/vector-icons/Feather';
import {
  hasRole,
  ItemList,
  ItineraryItem,
  newId,
  positionBetween,
} from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ItemSheet, type ItemFields, type SaveResult } from '@/components/item-sheet';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import {
  ANYTIME,
  byPosition,
  dayKeyOf,
  dayOfMonth,
  formatCost,
  ITEM_TYPE_META,
  planDays,
  shortDate,
  weekdayOf,
  type DayKey,
} from '@/lib/plan';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type Editors = Record<string, { itemId: string; name: string }>;

/** The shared day-by-day plan (design: Plan.dc.html), live for everyone on the trip. */
export default function PlanTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const [items, setItems] = useState<ItineraryItem[] | null>(null);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<DayKey | null>(null);
  const [sheet, setSheet] = useState(false);
  const [editors, setEditors] = useState<Editors>({});
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tripId = trip?.id;
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 3500);
  };

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const data = await request(`/trips/${tripId}/items`, { schema: ItemList });
      setItems(data.items);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the plan');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Applies a newer copy of an item; ignores anything older than what we have. */
  const upsertLocal = useCallback((item: ItineraryItem) => {
    setItems((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((p) => p.id === item.id);
      if (i === -1) return [...prev, item];
      if (prev[i]!.version > item.version) return prev;
      const next = [...prev];
      next[i] = item;
      return next;
    });
  }, []);
  const removeLocal = useCallback((id: string) => {
    setItems((prev) => prev?.filter((p) => p.id !== id) ?? prev);
  }, []);

  useTripRealtime(tripId, (message) => {
    if (message.kind === 'reconnected') return void load();
    if (message.kind === 'presence') {
      const { userId, itemId, displayName } = message.presence;
      if (userId === trip?.myUserId) return;
      setEditors((prev) => {
        const next = { ...prev };
        if (itemId) next[userId] = { itemId, name: displayName };
        else delete next[userId];
        return next;
      });
      return;
    }
    if (message.kind === 'error' && message.code === 'removed') return router.replace('/trips');
    if (message.kind !== 'event') return;

    const { event } = message;
    if (event.type === 'item.upserted') {
      const parsed = ItineraryItem.safeParse(event.payload);
      if (parsed.success) upsertLocal(parsed.data);
    } else if (event.type === 'item.deleted') {
      removeLocal(event.entityId);
    } else if (event.type.startsWith('member.')) {
      void reloadTrip();
    }
  });

  const days = useMemo(
    () => (trip ? planDays(trip.startDate, trip.endDate, items ?? []) : []),
    [trip, items],
  );
  const showAnytime = days.length === 0 || (items ?? []).some((i) => i.date === null);
  const dayKeys: DayKey[] = useMemo(
    () => (showAnytime ? [ANYTIME, ...days] : days),
    [showAnytime, days],
  );
  const current: DayKey = selected && dayKeys.includes(selected) ? selected : (days[0] ?? ANYTIME);
  const dayItems = useMemo(
    () => (items ?? []).filter((i) => dayKeyOf(i) === current).sort(byPosition),
    [items, current],
  );

  const lastPositionOn = (key: DayKey) => {
    const onDay = (items ?? []).filter((i) => dayKeyOf(i) === key).sort(byPosition);
    return onDay.at(-1)?.position ?? null;
  };

  // The sheet here only adds; editing happens on the item's own screen.
  const openSheet = () => setSheet(true);
  const closeSheet = () => {
    setSheet(false);
    setDraftTitle(undefined);
  };

  // "Add to plan" from a chat message lands here with ?draft=<text>.
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const [draftTitle, setDraftTitle] = useState<string>();
  useEffect(() => {
    if (!draft || !canEdit) return;
    setDraftTitle(draft);
    setSheet(true);
    router.setParams({ draft: undefined });
  }, [draft, canEdit]);

  /** Shows the new item straight away, then confirms with the server. */
  const save = async (fields: ItemFields): Promise<SaveResult> => {
    if (!trip) return { error: 'Trip not loaded' };
    const id = newId();
    const position = positionBetween(lastPositionOn(fields.date ?? ANYTIME), null);
    const optimistic: ItineraryItem = {
      ...fields,
      id,
      tripId: trip.id,
      position,
      createdBy: trip.myUserId,
      version: 0,
      updatedAt: new Date().toISOString(),
    };
    upsertLocal(optimistic);
    setSelected(fields.date ?? ANYTIME);
    try {
      upsertLocal(
        await request(`/trips/${trip.id}/items`, {
          method: 'POST',
          body: { ...fields, id, position },
          schema: ItineraryItem,
        }),
      );
      return { ok: true };
    } catch (e) {
      removeLocal(id);
      return { error: e instanceof ApiError ? e.message : 'Could not add that' };
    }
  };

  /** Drag and drop: only the moved item gets a new position between its new neighbours. */
  const onDragEnd = async ({ data, from, to }: { data: ItineraryItem[]; from: number; to: number }) => {
    if (from === to) return;
    const moved = data[to]!;
    let position: string;
    try {
      position = positionBetween(data[to - 1]?.position ?? null, data[to + 1]?.position ?? null);
    } catch {
      return void load();
    }
    upsertLocal({ ...moved, position });
    try {
      upsertLocal(
        await request(`/items/${moved.id}`, {
          method: 'PATCH',
          body: { version: moved.version, position },
          schema: ItineraryItem,
        }),
      );
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && ItineraryItem.safeParse(e.data.current);
      if (latest && latest.success) {
        upsertLocal(latest.data);
        showToast('Someone changed that item first. Showing the latest order.');
      } else {
        showToast(e instanceof ApiError ? e.message : 'Could not move that');
        void load();
      }
    }
  };

  if (!trip) return null;

  const dayIndex = days.indexOf(current);
  const heading =
    current === ANYTIME
      ? 'Anytime'
      : `${dayIndex >= 0 ? `Day ${dayIndex + 1} · ` : ''}${shortDate(current)}`;

  const renderItem = ({ item, drag, isActive }: RenderItemParams<ItineraryItem>) => {
    const editor = Object.values(editors).find((e) => e.itemId === item.id);
    const meta = [
      item.endTime && item.startTime ? `until ${item.endTime}` : null,
      item.placeName,
      item.costEstimateMinor != null && item.costCurrency
        ? `about ${formatCost(item.costEstimateMinor, item.costCurrency)} each`
        : null,
    ].filter(Boolean);
    return (
      <ScaleDecorator>
        <View style={styles.itemRow}>
          <Text style={styles.time}>{item.startTime ?? ''}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}${item.startTime ? ` at ${item.startTime}` : ''}`}
            accessibilityHint={canEdit ? 'Double tap for details. Hold to drag.' : 'Double tap for details.'}
            onPress={() => router.push(`/trips/${trip.id}/items/${item.id}`)}
            onLongPress={canEdit ? drag : undefined}
            delayLongPress={250}
            disabled={isActive}
            style={[styles.card, editor && styles.cardEditing, isActive && styles.cardDragging]}
          >
            {editor ? (
              <Text style={styles.editingTag}>{editor.name} is editing</Text>
            ) : null}
            <View style={styles.cardTop}>
              <Feather name={ITEM_TYPE_META[item.type].icon} size={16} color={colors.accent} />
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {canEdit ? <Feather name="menu" size={16} color="#B9B2A6" /> : null}
            </View>
            {meta.length > 0 ? <Body style={{ fontSize: 13 }}>{meta.join(' · ')}</Body> : null}
          </Pressable>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Title>Plan</Title>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {dayKeys.map((key) => {
            const on = key === current;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                aria-selected={on}
                accessibilityLabel={key === ANYTIME ? 'Anytime' : shortDate(key)}
                onPress={() => setSelected(key)}
                style={[styles.pill, on && styles.pillOn]}
              >
                {key === ANYTIME ? (
                  <Feather name="inbox" size={18} color={on ? '#FFFFFF' : colors.ink} />
                ) : (
                  <>
                    <Text style={[styles.pillDay, on && { color: '#E4DED4' }]}>{weekdayOf(key)}</Text>
                    <Text style={[styles.pillNum, on && { color: '#FFFFFF' }]}>{dayOfMonth(key)}</Text>
                  </>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.heading}>{heading}</Text>
        {current === ANYTIME ? (
          <Body style={{ fontSize: 13 }}>
            {days.length === 0
              ? 'Add dates to the trip to plan day by day. Until then, everything lives here.'
              : 'Ideas that aren\'t on a day yet.'}
          </Body>
        ) : null}
      </View>

      {toast ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Body style={{ color: '#FFFFFF' }}>{toast}</Body>
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Body>{error}</Body>
          <Button label="Try again" variant="outline" onPress={load} />
        </View>
      ) : !items ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <DraggableFlatList
          data={dayItems}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          onDragEnd={onDragEnd}
          containerStyle={{ flex: 1 }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="calendar" size={28} color={colors.accent} />
              <Body style={{ textAlign: 'center' }}>
                Nothing planned for {current === ANYTIME ? 'now' : 'this day'} yet.
              </Body>
              {canEdit ? <Button label="Add the first thing" variant="outline" onPress={() => openSheet()} /> : null}
            </View>
          }
        />
      )}

      {canEdit && items && items.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add to plan" onPress={() => openSheet()} style={styles.fab}>
          <Feather name="plus" size={26} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <ItemSheet
        visible={sheet}
        defaultDay={current}
        draftTitle={draftTitle}
        days={days}
        currency={trip.baseCurrency}
        canEdit={canEdit}
        onSave={save}
        onClose={closeSheet}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.md },
  pills: { gap: space.sm, paddingVertical: 2 },
  pill: { width: 58, height: 60, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillDay: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  pillNum: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  heading: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  list: { padding: space.xl, paddingTop: space.md, paddingBottom: 120, gap: space.sm },
  itemRow: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  time: { width: 46, paddingTop: 14, fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 4 },
  cardEditing: { borderWidth: 2, borderColor: colors.coral, padding: 13 },
  cardDragging: { borderColor: colors.accent, transform: [{ scale: 1.02 }] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  editingTag: { position: 'absolute', top: -10, right: 12, fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF', backgroundColor: colors.coral, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  fab: { position: 'absolute', right: space.xl, bottom: space.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  toast: { marginHorizontal: space.xl, marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
});
