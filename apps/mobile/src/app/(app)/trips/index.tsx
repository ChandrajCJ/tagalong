import Feather from '@expo/vector-icons/Feather';
import { groupTrips, MemoryList, MyTrips, type DeletedTrip, type Memory, type TripSummary } from '@tagalong/shared';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoverImage } from '@/components/cover-image';
import { IconButton } from '@/components/icon-button';
import { Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { todayIso } from '@/lib/dates';
import { formatDateRange, readinessLine, tripCountdown } from '@/lib/format';
import { registerForPush, setAppBadge } from '@/lib/push';
import { useTripsRealtime } from '@/lib/realtime';
import { youAre } from '@/lib/roles';
import { secureStorage } from '@/lib/storage';
import { colors, fonts, radius, space } from '@/theme';

/** Changes that move the "new" counts or the list itself. */
const LIST_EVENTS = new Set(['message.created', 'message.deleted', 'read.updated', 'trip.deleted', 'trip.updated']);

type Row = { type: 'trip'; trip: TripSummary } | { type: 'deleted'; trip: DeletedTrip };
type Section = { key: string; title: string; data: Row[]; toggle?: boolean };

/** Keychain keys allow letters, digits, ".", "-" and "_". */
const dismissedKey = (m: Memory, today: string) => `memory-dismissed.${m.tripId}.${today}`;

/** "1 year ago: Goa with the gang", opening that day of its journal. Each can be put away for the day. */
function Memories() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const today = todayIso();

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void (async () => {
        const list = await request(`/me/memories?today=${today}`, { schema: MemoryList }).catch(() => null);
        if (!list || !live) return;
        const kept = await Promise.all(list.memories.map(async (m) => ((await secureStorage.get(dismissedKey(m, today))) ? null : m)));
        if (live) setMemories(kept.filter((m): m is Memory => m !== null));
      })();
      return () => {
        live = false;
      };
    }, [today]),
  );

  if (memories.length === 0) return null;
  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      {memories.map((m) => (
        <Pressable
          key={m.tripId}
          accessibilityRole="button"
          accessibilityLabel={`${m.yearsAgo === 1 ? 'A year' : `${m.yearsAgo} years`} ago today: ${m.tripName}. Opens that day of the journal.`}
          onPress={() => router.push(`/trips/${m.tripId}/journal/${m.date}`)}
        >
          <CoverImage color={m.coverColor} uri={m.coverUrl} cacheKey={`cover-${m.tripId}`} style={styles.memory}>
            <View style={{ flex: 1, justifyContent: 'flex-end', gap: 2 }}>
              <Text style={[styles.memoryKicker, !m.coverUrl && { color: colors.onCover }]}>{m.yearsAgo === 1 ? '1 year ago today' : `${m.yearsAgo} years ago today`}</Text>
              <Text style={[styles.memoryTitle, !m.coverUrl && { color: colors.onCover, textShadowRadius: 0 }]} numberOfLines={1}>
                {m.tripName}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hide this memory for today"
              onPress={() => {
                void secureStorage.set(dismissedKey(m, today), '1');
                setMemories((list) => list.filter((x) => x.tripId !== m.tripId));
              }}
              style={styles.memoryClose}
            >
              <Feather name="x" size={18} color={m.coverUrl ? colors.onPhoto : colors.onCover} />
            </Pressable>
          </CoverImage>
        </Pressable>
      ))}
    </View>
  );
}

/** Your trips (design: Home.dc.html). */
export default function Trips() {
  const [data, setData] = useState<MyTrips | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await request('/trips', { schema: MyTrips });
      setData(mine);
      setError(undefined);
      setAppBadge(mine.trips.reduce((sum, t) => sum + t.unreadCount, 0));
      // Ask for notifications once there's a trip to be notified about.
      if (mine.trips.length > 0) void registerForPush();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your trips');
    }
  }, []);

  // Reload whenever this screen comes back into view (for example, after creating a trip).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // New messages, reads and deleted trips change the list: refetch, a moment after a burst.
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  useTripsRealtime(
    (data?.trips ?? []).map((t) => t.id),
    (_tripId, m) => {
      if (m.kind === 'reconnected' || (m.kind === 'event' && LIST_EVENTS.has(m.event.type))) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => void load(), 400);
      }
    },
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const restore = async (trip: DeletedTrip) => {
    try {
      await request(`/trips/${trip.id}/restore`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not restore that trip');
    }
  };

  const sections = useMemo<Section[]>(() => {
    if (!data) return [];
    const { upcoming, past, archived } = groupTrips(data.trips, todayIso());
    const asRows = (trips: TripSummary[]): Row[] => trips.map((trip) => ({ type: 'trip', trip }));
    return [
      { key: 'upcoming', title: 'Upcoming and planning', data: asRows(upcoming) },
      { key: 'past', title: 'Past trips', data: asRows(past) },
      {
        key: 'archived',
        title: `Archived (${archived.length})`,
        data: showArchived ? asRows(archived) : [],
        toggle: archived.length > 0,
      },
      {
        key: 'deleted',
        title: 'Recently deleted',
        data: data.deleted.map((trip): Row => ({ type: 'deleted', trip })),
      },
    ].filter((s) => s.data.length > 0 || s.toggle);
  }, [data, showArchived]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Body>Welcome back</Body>
          <Title style={{ fontSize: 32 }}>Your trips</Title>
        </View>
        <IconButton icon="user" label="Your profile" onPress={() => router.push('/profile')} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(row) => `${row.type}-${row.trip.id}`}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          error ? (
            <View style={styles.errorBox}>
              <Body style={{ color: colors.coralInk }}>{error}</Body>
              <Button label="Try again" variant="outline" onPress={load} />
            </View>
          ) : (
            <Memories />
          )
        }
        ListEmptyComponent={
          data && !error ? (
            <View style={styles.empty}>
              <Title style={{ fontSize: 24 }}>Start your first trip</Title>
              <Body>Create a trip, invite your friends and plan it together.</Body>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) =>
          section.toggle ? (
            <Pressable
              accessibilityRole="button"
              aria-expanded={showArchived}
              accessibilityHint={showArchived ? 'Hides archived trips' : 'Shows archived trips'}
              onPress={() => setShowArchived((v) => !v)}
              style={styles.sectionToggle}
            >
              <Label>{section.title}</Label>
              <Feather name={showArchived ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
            </Pressable>
          ) : (
            <Label style={styles.sectionTitle}>{section.title}</Label>
          )
        }
        renderItem={({ item }) =>
          item.type === 'trip' ? (
            <TripCard trip={item.trip} />
          ) : (
            <DeletedRow trip={item.trip} onRestore={() => void restore(item.trip)} />
          )
        }
      />

      <Button
        label="+  New trip"
        variant="dark"
        onPress={() => router.push('/trips/new')}
        style={styles.fab}
      />
    </SafeAreaView>
  );
}

function TripCard({ trip }: { trip: TripSummary }) {
  const countdown = tripCountdown(trip.startDate, trip.endDate);
  const people = trip.memberCount === 1 ? '1 person' : `${trip.memberCount} people`;
  // Getting ready matters before the trip, not after it.
  const ready = countdown && countdown !== 'Past' && !trip.archived ? readinessLine(trip.readiness) : null;
  const unread = trip.unreadCount > 0 ? `${trip.unreadCount > 99 ? '99+' : trip.unreadCount} new` : null;
  return (
    <Link href={`/trips/${trip.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${trip.name}, ${formatDateRange(trip.startDate, trip.endDate)}${unread ? `, ${trip.unreadCount} new messages` : ''}`}
        // One flat style object: Link asChild hands the Pressable its own style,
        // so a function style is dropped (the card lost its border) and an
        // array makes Expo Router throw.
        style={trip.archived ? StyleSheet.flatten([styles.card, { opacity: 0.8 }]) : styles.card}
      >
        <CoverImage color={trip.coverColor} uri={trip.coverUrl} cacheKey={`cover-${trip.id}`} credit={trip.coverCredit} style={styles.cover}>
          {countdown ? <Text style={styles.chip}>{countdown}</Text> : <View />}
          {unread ? (
            <View style={styles.unread}>
              <Feather name="message-square" size={12} color={colors.onFill} />
              <Text style={styles.unreadText}>{unread}</Text>
            </View>
          ) : null}
        </CoverImage>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{trip.name}</Text>
          <Body>
            {formatDateRange(trip.startDate, trip.endDate)} · {trip.destination}
          </Body>
          <Text style={styles.meta}>
            {people} · {youAre(trip.myRole)}
          </Text>
          {ready ? (
            <View style={styles.ready}>
              <Feather name="check-square" size={12} color={colors.accentInk} />
              <Text style={styles.readyText}>{ready}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

/** A trip the owner deleted: gone for everyone, but it can still come back. */
function DeletedRow({ trip, onRestore }: { trip: DeletedTrip; onRestore: () => void }) {
  const daysLeft = Math.max(0, Math.ceil((new Date(trip.purgeAt).getTime() - Date.now()) / 86_400_000));
  return (
    <View style={styles.deleted}>
      <View style={[styles.deletedSwatch, { backgroundColor: trip.coverColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.deletedTitle} numberOfLines={1}>
          {trip.name}
        </Text>
        <Body style={{ fontSize: 13 }}>
          {daysLeft === 1 ? 'Gone for good tomorrow' : `Gone for good in ${daysLeft} days`}
        </Body>
      </View>
      <Button label="Restore" variant="outline" onPress={onRestore} style={{ minHeight: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  memory: { height: 110, borderRadius: radius.lg, padding: space.lg, flexDirection: 'row' },
  memoryKicker: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.onPhoto },
  memoryTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onPhoto, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  memoryClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginTop: -space.sm, marginRight: -space.sm },
  ready: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  readyText: { fontFamily: fonts.medium, fontSize: 12, color: colors.accentInk },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.md },
  list: { padding: space.xl, paddingBottom: 120, gap: space.lg },
  sectionTitle: { marginTop: space.sm },
  sectionToggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, marginTop: space.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cover: { height: 120, padding: space.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chip: { backgroundColor: colors.surface, color: colors.ink, fontFamily: fonts.bold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  unread: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.coral, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  unreadText: { color: colors.onFill, fontFamily: fonts.bold, fontSize: 12 },
  cardBody: { padding: space.lg, gap: 4 },
  cardTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  meta: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk, marginTop: 4 },
  deleted: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  deletedSwatch: { width: 40, height: 40, borderRadius: 12, opacity: 0.6 },
  deletedTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  empty: { paddingVertical: 60, gap: space.sm, alignItems: 'center' },
  errorBox: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.coralSoft },
  fab: { position: 'absolute', right: space.xl, bottom: 36 },
});
