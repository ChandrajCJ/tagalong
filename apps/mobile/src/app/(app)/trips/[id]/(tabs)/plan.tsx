import Feather from '@expo/vector-icons/Feather';
import {
  DayReordered,
  hasRole,
  ItemList,
  ItineraryItem,
  movableCount,
  newId,
  openTodosByItem,
  PlaceSearch,
  positionBetween,
  TRAVEL_MODES,
  TripDay,
  type PlaceResult,
  type RouteLeg,
} from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DayNoteSheet } from '@/components/day-note-sheet';
import { FindOnMapSheet } from '@/components/find-on-map-sheet';
import { ItemSheet, type ItemFields, type SaveResult } from '@/components/item-sheet';
import { PlanMapView } from '@/components/plan-map-view';
import { ShortestOrderSheet } from '@/components/shortest-order-sheet';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import {
  ANYTIME,
  byPosition,
  dateOfKey,
  dayKeyOf,
  dayOfMonth,
  formatCost,
  ITEM_TYPE_META,
  planDays,
  shortDate,
  weekdayOf,
  type DayKey,
} from '@/lib/plan';
import { openDirections } from '@/lib/directions';
import { useTripLists } from '@/lib/lists';
import { formatDistance, formatDuration, MODE_META, useDayRoute, useRouteMode } from '@/lib/routes';
import { useTripRealtime } from '@/lib/realtime';
import { VIEWER_NOTE } from '@/lib/roles';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type Editors = Record<string, { itemId: string; name: string }>;

/** A stop worth suggesting a place for: not on the map, not "other", and nobody said it needs none. */
const needsPlace = (i: ItineraryItem) => i.latitude === null && i.type !== 'other' && !i.placeHintDismissed;
/** How many stops of a day get a guess looked up at once, to stay gentle on the search. */
const GUESSES_PER_DAY = 5;

/** The shared day-by-day plan (design: Plan.dc.html), live for everyone on the trip. */
export default function PlanTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const [items, setItems] = useState<ItineraryItem[] | null>(null);
  // Days someone gave a name or a note.
  const [dayNotes, setDayNotes] = useState<TripDay[]>([]);
  const [editingDay, setEditingDay] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<DayKey | null>(null);
  const [sheet, setSheet] = useState(false);
  const [editors, setEditors] = useState<Editors>({});
  const [toast, setToast] = useState<string>();
  // The day-by-day list, or every stop on a map.
  const [view, setView] = useState<'list' | 'map'>('list');
  const [shortest, setShortest] = useState(false);
  // Travel connectors hide while a card is being dragged; they'd point at the old neighbours.
  const [dragging, setDragging] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // "Add place" on a stop: the search, prefilled with the stop's text.
  const [findingFor, setFindingFor] = useState<ItineraryItem | null>(null);
  // A single clear match for a stop's text near the trip, offered as "Is this …?". Keyed by id and title.
  const [guesses, setGuesses] = useState<Record<string, PlaceResult | null>>({});

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
      setDayNotes(data.days);
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
  const upsertDay = useCallback((day: TripDay) => {
    setDayNotes((prev) => {
      const old = prev.find((d) => d.date === day.date);
      if (old && old.version > day.version) return prev;
      return [...prev.filter((d) => d.date !== day.date), day];
    });
  }, []);
  // To-dos linked to plan items, for the ☑ badge.
  const { lists: todoLists, items: listItems } = useTripLists(trip);
  const openTodos = useMemo(
    () => (trip && todoLists ? openTodosByItem(todoLists, listItems, trip.myUserId) : new Map<string, number>()),
    [trip, todoLists, listItems],
  );
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
    } else if (event.type === 'day.upserted') {
      const parsed = TripDay.safeParse(event.payload);
      if (parsed.success) upsertDay(parsed.data);
    } else if (event.type === 'day.reordered') {
      const parsed = DayReordered.safeParse(event.payload);
      if (parsed.success) parsed.data.items.forEach(upsertLocal);
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

  const currentDate = dateOfKey(current);
  const [mode, setMode] = useRouteMode(tripId ?? '', currentDate, dayItems);
  const route = useDayRoute(tripId ?? '', currentDate, mode, dayItems);
  const located = dayItems.filter((i) => i.latitude !== null && i.longitude !== null).length;
  // The leg leaving each item, but only to the item right after it on the list.
  const legFrom = useMemo(() => {
    const next = new Map(dayItems.slice(0, -1).map((item, n) => [item.id, dayItems[n + 1]!.id]));
    return new Map((route?.legs ?? []).filter((l) => next.get(l.fromId) === l.toId).map((l) => [l.fromId, l]));
  }, [route, dayItems]);
  const canShorten = canEdit && currentDate !== null && movableCount(dayItems) >= 3;
  const placeless = canEdit ? dayItems.filter(needsPlace) : [];

  // Look up a guess for the day's stops without a place: only a single clear match is offered.
  const guessKey = (i: ItineraryItem) => `${i.id}:${i.title}`;
  useEffect(() => {
    if (!tripId || !trip?.location) return;
    const todo = placeless.filter((i) => !(guessKey(i) in guesses)).slice(0, GUESSES_PER_DAY);
    if (todo.length === 0) return;
    let live = true;
    void Promise.all(
      todo.map(async (i) => {
        const found = await request(`/places/search?scope=place&tripId=${tripId}&q=${encodeURIComponent(i.title)}`, {
          schema: PlaceSearch,
        }).catch(() => null);
        return [guessKey(i), found?.results.length === 1 ? found.results[0]! : null] as const;
      }),
    ).then((pairs) => {
      if (live) setGuesses((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, trip?.location, placeless.map(guessKey).join('|')]);

  /** Puts a stop on the map at the picked place, keeping any place name it already had. */
  const pinItem = async (item: ItineraryItem, place: { name: string; latitude: number; longitude: number; placeRef: string | null }) => {
    try {
      upsertLocal(
        await request(`/items/${item.id}`, {
          method: 'PATCH',
          body: {
            version: item.version,
            placeName: item.placeName ?? place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            placeRef: place.placeRef,
          },
          schema: ItineraryItem,
        }),
      );
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && ItineraryItem.safeParse(e.data.current);
      if (latest && latest.success) upsertLocal(latest.data);
      throw new Error(e instanceof ApiError ? e.message : 'Could not save that', { cause: e });
    }
  };

  /** "No place needed": the plan stops suggesting one for this stop. */
  const dismissPlace = async (item: ItineraryItem) => {
    upsertLocal({ ...item, placeHintDismissed: true });
    try {
      upsertLocal(
        await request(`/items/${item.id}`, {
          method: 'PATCH',
          body: { version: item.version, placeHintDismissed: true },
          schema: ItineraryItem,
        }),
      );
    } catch {
      void load();
    }
  };

  /** Several items saved at once (a new order), or the day as it is now after a conflict. */
  const applyOrder = (saved: ItineraryItem[], note?: string) => {
    saved.forEach(upsertLocal);
    if (note) showToast(note);
  };

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

  // "Add to plan" from a chat message lands here with ?draft=<text>; a push about a day, with ?day=.
  const { draft, day } = useLocalSearchParams<{ draft?: string; day?: string }>();
  useEffect(() => {
    if (!day) return;
    setSelected(day as DayKey);
    router.setParams({ day: undefined });
  }, [day]);
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
      placeHintDismissed: false,
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
    setDragging(false);
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
      ? 'No day yet'
      : `${dayIndex >= 0 ? `Day ${dayIndex + 1} · ` : ''}${shortDate(current)}`;

  const renderItem = ({ item, drag, isActive }: RenderItemParams<ItineraryItem>) => {
    const editor = Object.values(editors).find((e) => e.itemId === item.id);
    const meta = [
      item.endTime && item.startTime
        ? `until ${item.endTime}${item.endTime <= item.startTime ? ' (next day)' : ''}`
        : null,
      item.placeName,
      item.costEstimateMinor != null && item.costCurrency
        ? `about ${formatCost(item.costEstimateMinor, item.costCurrency)} each`
        : null,
    ].filter(Boolean);
    return (
      <ScaleDecorator>
        <View style={styles.itemRow}>
          <Text style={styles.time}>{item.startTime ?? ''}</Text>
          {/* The card and its directions link are siblings: a button can't hold another button. */}
          <View style={[styles.card, editor && styles.cardEditing, isActive && styles.cardDragging]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.startTime ? ` at ${item.startTime}` : ''}`}
              accessibilityHint={canEdit ? 'Double tap for details. Hold to drag.' : 'Double tap for details.'}
              onPress={() => router.push(`/trips/${trip.id}/items/${item.id}`)}
              onLongPress={canEdit ? drag : undefined}
              delayLongPress={250}
              disabled={isActive}
              style={{ gap: 4 }}
            >
              {editor ? (
                <Text style={styles.editingTag}>{editor.name} is editing</Text>
              ) : null}
              <View style={styles.cardTop}>
                <Feather name={ITEM_TYPE_META[item.type].icon} size={16} color={colors.accent} />
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {openTodos.get(item.id) ? (
                  <View style={styles.todoBadge} accessibilityLabel={`${openTodos.get(item.id)} open to-dos`}>
                    <Feather name="check-square" size={11} color={colors.accentInk} />
                    <Text style={styles.todoBadgeText}>{openTodos.get(item.id)}</Text>
                  </View>
                ) : null}
                {item.latitude !== null ? (
                  <Feather name="map-pin" size={13} color={colors.muted} accessibilityLabel="On the map" />
                ) : null}
                {canEdit ? <Feather name="move" size={15} color="#B9B2A6" /> : null}
              </View>
              {meta.length > 0 ? <Body style={{ fontSize: 13 }}>{meta.join(' · ')}</Body> : null}
            </Pressable>
            {item.placeName || item.latitude !== null ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Directions to ${item.placeName ?? item.title}`}
                onPress={() => openDirections(item.placeName ?? item.title, trip.destination, item)}
                style={styles.directions}
              >
                <Feather name="navigation" size={13} color={colors.accent} />
                <Text style={styles.directionsText}>Directions</Text>
              </Pressable>
            ) : null}
            {canEdit && needsPlace(item) && !isActive ? (
              <PlaceHint
                item={item}
                guess={guesses[guessKey(item)] ?? null}
                onYes={(g) =>
                  void pinItem(item, { name: g.name, latitude: g.latitude, longitude: g.longitude, placeRef: g.id }).catch((e: Error) =>
                    showToast(e.message),
                  )
                }
                onFind={() => setFindingFor(item)}
                onDismiss={() => void dismissPlace(item)}
              />
            ) : null}
          </View>
        </View>
        {!dragging && !isActive ? connector(legFrom.get(item.id), !!route?.estimated) : null}
      </ScaleDecorator>
    );
  };

  /** "🚶 12 min · 900 m" between two stops on the map, or nothing. */
  const connector = (leg: RouteLeg | undefined, estimated: boolean) =>
    leg ? (
      <View style={styles.connector} accessibilityLabel={`${estimated ? 'About ' : ''}${formatDuration(leg.durationS)} ${MODE_META[mode].by} to the next stop`}>
        <View style={styles.connectorLine} />
        <Text style={styles.connectorText}>
          {MODE_META[mode].emoji} {estimated ? 'about ' : ''}
          {formatDuration(leg.durationS)} · {formatDistance(leg.distanceM)}
        </Text>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Title>Plan</Title>
          <View style={styles.viewSwitch} accessibilityRole="tablist">
            {(['list', 'map'] as const).map((v) => (
              <Pressable
                key={v}
                accessibilityRole="tab"
                aria-selected={view === v}
                onPress={() => setView(v)}
                style={[styles.viewOption, view === v && styles.viewOptionOn]}
              >
                <Feather name={v === 'list' ? 'list' : 'map'} size={14} color={view === v ? colors.ink : colors.muted} />
                <Text style={[styles.viewText, view === v && { color: colors.ink }]}>{v === 'list' ? 'List' : 'Map'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {view === 'list' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
              {dayKeys.map((key) => {
                const on = key === current;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    aria-selected={on}
                    accessibilityLabel={key === ANYTIME ? 'No day yet' : shortDate(key)}
                    onPress={() => setSelected(key)}
                    style={[styles.pill, on && styles.pillOn]}
                  >
                    {key === ANYTIME ? (
                      <Text style={[styles.pillNoDay, on && { color: '#FFFFFF' }]}>No{'\n'}day</Text>
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
            {currentDate ? (
              (() => {
                const note = dayNotes.find((d) => d.date === currentDate);
                const text = [note?.title, note?.notes].filter(Boolean).join(' — ');
                if (!text && !canEdit) return null;
                return (
                  <Pressable
                    accessibilityRole={canEdit ? 'button' : undefined}
                    accessibilityHint={canEdit ? 'Edit the day’s name and note' : undefined}
                    disabled={!canEdit}
                    onPress={() => setEditingDay(true)}
                    style={[styles.dayNote, !text && styles.dayNoteEmpty]}
                  >
                    <Feather name={text ? 'file-text' : 'plus'} size={13} color={text ? colors.ink : colors.accent} />
                    <Text style={[styles.dayNoteText, !text && { color: colors.accent }]} numberOfLines={3}>
                      {text || 'Name this day or add a note'}
                    </Text>
                  </Pressable>
                );
              })()
            ) : null}
            {currentDate && located >= 2 ? (
              <View style={styles.routeRow}>
                <Text style={styles.routeTotal}>
                  {route
                    ? `${MODE_META[mode].emoji} ${route.estimated ? 'about ' : ''}${formatDuration(route.totalDurationS)} · ${formatDistance(route.totalDistanceM)} between stops`
                    : 'Working out travel times…'}
                </Text>
                <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="How you'll get around">
                  {TRAVEL_MODES.map((m) => (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      aria-checked={mode === m}
                      onPress={() => setMode(m)}
                      style={[styles.mode, mode === m && styles.modeOn]}
                    >
                      <Text style={[styles.modeText, mode === m && { color: '#FFFFFF' }]}>{MODE_META[m].label}</Text>
                    </Pressable>
                  ))}
                </View>
                {canShorten ? (
                  <Pressable accessibilityRole="button" onPress={() => setShortest(true)} style={styles.shortest}>
                    <Feather name="shuffle" size={13} color={colors.accentInk} />
                    <Text style={styles.shortestText}>Shortest order</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {placeless.length >= 2 ? (
              <View style={styles.placeNudge}>
                <Feather name="map-pin" size={13} color={colors.accentInk} />
                <Text style={styles.placeNudgeText}>
                  {placeless.length} stops aren’t on the map yet. Add places for travel times.
                </Text>
              </View>
            ) : null}
            {current === ANYTIME ? (
              <Body style={{ fontSize: 13 }}>
                {days.length === 0
                  ? 'This trip has no dates yet, so everything lives here. Add dates from the Overview (Edit) to plan day by day.'
                  : 'Plan items that don\'t have a day yet.'}
              </Body>
            ) : null}
            {canEdit && dayItems.length > 0 ? (
              <Body style={{ fontSize: 12 }}>Tap an item for details. Hold and drag to change the order.</Body>
            ) : null}
          </>
        ) : (
          <Body style={{ fontSize: 13 }}>Every stop with a location, coloured by day. Outlined pins are ideas. Pick a day to see its route.</Body>
        )}
      </View>

      {toast ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Body style={{ color: '#FFFFFF' }}>{toast}</Body>
        </View>
      ) : null}

      {view === 'map' && items ? (
        <PlanMapView trip={trip} items={items} days={days} />
      ) : (
        <>
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
              onDragBegin={() => setDragging(true)}
              onDragEnd={onDragEnd}
              containerStyle={{ flex: 1 }}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="calendar" size={28} color={colors.accent} />
                  <Body style={{ textAlign: 'center' }}>
                    {current === ANYTIME ? 'Nothing here yet.' : 'Nothing planned for this day yet.'}
                  </Body>
                  {canEdit ? (
                    <Button label="Add the first thing" variant="outline" onPress={() => openSheet()} />
                  ) : (
                    <Body style={{ textAlign: 'center', fontSize: 13 }}>{VIEWER_NOTE}</Body>
                  )}
                </View>
              }
            />
          )}

          {canEdit && items && items.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add to plan" onPress={() => openSheet()} style={styles.fab}>
              <Feather name="plus" size={20} color="#FFFFFF" />
              <Text style={styles.fabText}>Add to plan</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {currentDate ? (
        <DayNoteSheet
          visible={editingDay}
          tripId={trip.id}
          date={currentDate}
          day={dayNotes.find((d) => d.date === currentDate)}
          onSaved={upsertDay}
          onClose={() => setEditingDay(false)}
        />
      ) : null}
      {currentDate ? (
        <ShortestOrderSheet
          visible={shortest}
          tripId={trip.id}
          date={currentDate}
          mode={mode}
          items={dayItems}
          onSaved={applyOrder}
          onClose={() => setShortest(false)}
        />
      ) : null}
      <FindOnMapSheet
        visible={!!findingFor}
        tripId={trip.id}
        query={findingFor?.placeName ?? findingFor?.title ?? ''}
        onPick={async (place) => {
          if (findingFor) await pinItem(findingFor, place);
          setFindingFor(null);
        }}
        onClose={() => setFindingFor(null)}
      />
      <ItemSheet
        visible={sheet}
        tripId={trip.id}
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

/** Under a stop with no place: "Is this Fort Aguada? Yes / Pick another", or a quiet "Add place". */
function PlaceHint(props: {
  item: ItineraryItem;
  guess: PlaceResult | null;
  onYes: (guess: PlaceResult) => void;
  onFind: () => void;
  onDismiss: () => void;
}) {
  const { guess } = props;
  return (
    <View style={styles.hint}>
      <Feather name="map-pin" size={13} color={colors.accent} />
      {guess ? (
        <Text style={styles.hintText} numberOfLines={2}>
          Is this <Text style={{ fontFamily: fonts.bold }}>{guess.name}</Text>
          {guess.address ? ` (${guess.address})` : ''}?
        </Text>
      ) : (
        <Text style={styles.hintText}>Not on the map yet</Text>
      )}
      {guess ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Yes, it's ${guess.name}`} onPress={() => props.onYes(guess)} style={styles.hintButton}>
          <Text style={styles.hintAction}>Yes</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Find ${props.item.title} on the map`} onPress={props.onFind} style={styles.hintButton}>
        <Text style={styles.hintAction}>{guess ? 'Pick another' : 'Add place'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="No place needed" onPress={props.onDismiss} style={styles.hintClose}>
        <Feather name="x" size={14} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  hintText: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  hintButton: { minHeight: 32, paddingHorizontal: 8, justifyContent: 'center' },
  hintAction: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
  hintClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  placeNudge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  placeNudgeText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.accentInk },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.md },
  pills: { gap: space.sm, paddingVertical: 2 },
  pill: { width: 58, height: 60, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillDay: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  pillNum: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewSwitch: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: '#ECE7DF' },
  viewOption: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 12, borderRadius: radius.pill },
  viewOptionOn: { backgroundColor: colors.surface },
  viewText: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  heading: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  list: { padding: space.xl, paddingTop: space.md, paddingBottom: 120, gap: space.sm },
  itemRow: { flexDirection: 'row', gap: space.md, marginBottom: space.sm },
  time: { width: 46, paddingTop: 14, fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 4 },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32, marginTop: 4, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  directionsText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  cardEditing: { borderWidth: 2, borderColor: colors.coral, padding: 13 },
  cardDragging: { borderColor: colors.accent, transform: [{ scale: 1.02 }] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  editingTag: { position: 'absolute', top: -10, right: 12, fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF', backgroundColor: colors.coral, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  fab: { position: 'absolute', right: space.xl, bottom: space.xl, flexDirection: 'row', gap: 6, height: 52, paddingHorizontal: 18, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  fabText: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  pillNoDay: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15, textAlign: 'center', color: colors.ink },
  dayNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: '#FBF3DC' },
  dayNoteEmpty: { backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 2 },
  dayNoteText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink },
  todoBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  todoBadgeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.accentInk },
  routeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  routeTotal: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, flexBasis: '100%' },
  modes: { flexDirection: 'row', padding: 2, borderRadius: radius.pill, backgroundColor: '#ECE7DF' },
  mode: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.pill },
  modeOn: { backgroundColor: colors.ink },
  modeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  shortest: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  shortestText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  connector: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginLeft: 46 + space.md + 14, marginTop: -2, marginBottom: space.sm },
  connectorLine: { width: 2, height: 18, borderRadius: 1, backgroundColor: colors.lineStrong },
  connectorText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  toast: { marginHorizontal: space.xl, marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
});
