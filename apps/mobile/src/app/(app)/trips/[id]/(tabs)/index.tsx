import Feather from '@expo/vector-icons/Feather';
import { hasRole, listsSummary, NextUp } from '@tagalong/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { CoverImage } from '@/components/cover-image';
import { DeleteTripSheet } from '@/components/delete-trip-sheet';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { IconButton } from '@/components/icon-button';
import { WeatherStrip } from '@/components/weather-strip';
import { ApiError, request } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { BOOKING_META, formatInZone, relativeFrom, routeOf, titleOf } from '@/lib/bookings';
import { formatDateRange, tripCountdown } from '@/lib/format';
import { useTripLists, useTripNotes } from '@/lib/lists';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Trip overview, the hub (design: Trip.dc.html). */
export default function TripOverview() {
  const { trip, error, reload } = useTrip();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string>();

  // Pick up changes made on other screens, such as someone joining.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (error) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Body style={{ textAlign: 'center' }}>{error}</Body>
        <Button label="Back to your trips" variant="outline" onPress={() => router.replace('/trips')} />
      </SafeAreaView>
    );
  }
  if (!trip) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const countdown = tripCountdown(trip.startDate, trip.endDate);
  const canInvite = hasRole(trip.myRole, 'editor');
  const isOwner = trip.myRole === 'owner';
  // On a photo the title is white, over the photo's darkened bottom.
  const onPhoto = !!trip.coverUrl;
  const base = `/trips/${trip.id}` as const;

  const setArchived = async (archived: boolean) => {
    try {
      await request(`${base}/archive`, { method: archived ? 'POST' : 'DELETE' });
      if (archived) router.replace('/trips');
      else await reload();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    }
  };

  const leave = async () => {
    if (!(await confirmAction(`Leave ${trip.name}?`, 'You’ll need a new invite to come back.', 'Leave'))) return;
    try {
      await request(`${base}/members/${trip.myUserId}`, { method: 'DELETE' });
      router.replace('/trips');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Couldn’t leave the trip. Try again.');
    }
  };

  const deleteTrip = async (): Promise<string | null> => {
    try {
      await request(base, { method: 'DELETE' });
      setDeleting(false);
      router.replace('/trips');
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Couldn’t delete the trip. Try again.';
    }
  };

  const menu: MenuAction[] = [
    trip.archived
      ? {
          icon: 'inbox',
          label: 'Unarchive',
          hint: 'Put it back with your other trips',
          onPress: () => void setArchived(false),
        }
      : {
          icon: 'archive',
          label: 'Archive',
          hint: 'Move it to Archived on your trips. Only you see this.',
          onPress: () => void setArchived(true),
        },
    isOwner
      ? {
          icon: 'trash-2',
          label: 'Delete trip',
          hint: 'Removes it for everyone. You can restore it for 30 days.',
          destructive: true,
          onPress: () => setDeleting(true),
        }
      : {
          icon: 'log-out',
          label: 'Leave trip',
          hint: 'You’ll need a new invite to come back',
          destructive: true,
          onPress: () => void leave(),
        },
  ];

  return (
    <View style={styles.screen}>
      <CoverImage
        color={trip.coverColor}
        uri={trip.coverUrl}
        cacheKey={`cover-${trip.id}`}
        credit={trip.coverCredit}
        style={styles.cover}
      >
        <SafeAreaView edges={['top']} style={styles.coverInner}>
          <View style={styles.coverTop}>
            <IconButton icon="chevron-left" iconSize={20} label="Back to your trips" tipAlign="left" onPress={() => router.replace('/trips')} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {canInvite ? (
                <IconButton icon="edit-2" label="Edit trip" onPress={() => router.push(`${base}/edit`)} />
              ) : null}
              {canInvite ? (
                <IconButton icon="user-plus" label="Invite people" onPress={() => router.push(`${base}/invite`)} />
              ) : null}
              <IconButton icon="users" label="People on this trip" onPress={() => router.push(`${base}/members`)} />
              <IconButton icon="more-horizontal" label="More: archive, delete or leave" onPress={() => setMenuOpen(true)} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={[styles.title, onPhoto && styles.onPhoto]}>
              {trip.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${trip.memberCount} travelers. See who's coming`}
              onPress={() => router.push(`${base}/members`)}
              style={styles.row}
            >
              <View style={{ flexDirection: 'row' }}>
                {trip.members.slice(0, 4).map((m, i) => (
                  <View key={m.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar name={m.displayName} color={avatarColor(i)} size={26} />
                  </View>
                ))}
              </View>
              <Text style={[styles.coverMeta, onPhoto && styles.onPhoto]}>
                {formatDateRange(trip.startDate, trip.endDate)} · {trip.memberCount}{' '}
                {trip.memberCount === 1 ? 'traveler' : 'travelers'}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </CoverImage>

      <ScrollView contentContainerStyle={styles.body}>
        {problem ? (
          <Pressable accessibilityRole="button" accessibilityHint="Hides this message" onPress={() => setProblem(undefined)} style={styles.problem}>
            <Body style={{ color: colors.coralInk }}>{problem}</Body>
          </Pressable>
        ) : null}
        {trip.archived ? (
          <View style={styles.archivedNote}>
            <Feather name="archive" size={16} color={colors.muted} />
            <Body style={{ flex: 1, fontSize: 13 }}>You archived this trip. It’s still here for everyone else.</Body>
            <Button label="Unarchive" variant="ghost" onPress={() => void setArchived(false)} style={{ minHeight: 36 }} />
          </View>
        ) : null}
        <View style={styles.card}>
          <Text style={styles.countdown}>{countdown ?? 'No dates yet'}</Text>
          <Body>{trip.destination}</Body>
          {!trip.startDate && canInvite ? (
            <Button
              label="Add dates"
              variant="outline"
              onPress={() => router.push(`${base}/edit`)}
              style={{ marginTop: space.sm, alignSelf: 'flex-start', minHeight: 40 }}
            />
          ) : null}
        </View>

        <WeatherStrip trip={trip} />

        <NextUpCard tripId={trip.id} />

        <GetReadyCard />

        {trip.location ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`${base}/explore`)}
            style={({ pressed }) => [styles.explore, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.exploreIcon}>
              <Feather name="compass" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.exploreTitle}>Explore {trip.destination.split(',')[0]}</Text>
              <Body style={{ fontSize: 13 }}>Sights, food, beaches and more nearby. Add favourites to Ideas.</Body>
            </View>
            <Feather name="chevron-right" size={18} color="#8C867B" />
          </Pressable>
        ) : canInvite ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`${base}/edit`)}
            style={({ pressed }) => [styles.explore, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.exploreIcon, { backgroundColor: colors.coral }]}>
              <Feather name="map-pin" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.exploreTitle}>Put {trip.destination.split(',')[0]} on the map</Text>
              <Body style={{ fontSize: 13 }}>Pick the destination from the suggestions to get weather and places to go.</Body>
            </View>
            <Feather name="chevron-right" size={18} color="#8C867B" />
          </Pressable>
        ) : null}

        <Label style={{ marginTop: space.sm }}>What you can do here</Label>
        <View style={styles.list}>
          {trip.memberCount === 1 && canInvite ? (
            <ActionRow
              icon="user-plus"
              tint="coral"
              title="Invite your crew"
              subtitle="Share a link so friends can join"
              onPress={() => router.push(`${base}/invite`)}
            />
          ) : null}
          <ActionRow
            icon="calendar"
            tint="accent"
            title="Plan the days"
            subtitle="What you're doing each day, with times, places and directions"
            onPress={() => router.push(`${base}/plan`)}
          />
          <ActionRow
            icon="zap"
            tint="accent"
            title="Suggest and vote on ideas"
            subtitle="Throw out places to go; the favourites move into the plan"
            onPress={() => router.push(`${base}/ideas`)}
          />
          <ActionRow
            icon="message-square"
            tint="accent"
            title="Talk it over"
            subtitle="Group chat, polls, and replies to any message"
            onPress={() => router.push(`${base}/chat`)}
          />
          <ActionRow
            icon="image"
            tint="accent"
            title="Share photos"
            subtitle="Everyone's photos in one album, by day and on a map"
            onPress={() => router.push(`${base}/photos`)}
          />
          <ActionRow
            icon="credit-card"
            tint="accent"
            title="Split costs"
            subtitle="Log what you pay; Tagalong works out who owes whom"
            onPress={() => router.push(`${base}/money`)}
          />
          <ActionRow
            icon="folder"
            tint="accent"
            title="Tickets & files"
            subtitle="Boarding passes, bookings and confirmations"
            onPress={() => router.push(`${base}/docs`)}
            last
          />
        </View>
      </ScrollView>

      <ActionMenu visible={menuOpen} title={trip.name} actions={menu} onClose={() => setMenuOpen(false)} />
      <DeleteTripSheet
        visible={deleting}
        tripName={trip.name}
        onDelete={deleteTrip}
        onClose={() => setDeleting(false)}
      />
    </View>
  );
}

/**
 * The next booking that hasn't started: "TP1234 · Thu 08:15 · in 2 days".
 * Its own component so it can fetch and listen without disturbing the hooks
 * of the screen around it, which returns early while the trip loads.
 */
function NextUpCard({ tripId }: { tripId: string }) {
  const [next, setNext] = useState<NextUp | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const data = await request(`/trips/${tripId}/next-up`, { schema: NextUp }).catch(() => null);
    if (data) setNext(data);
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind !== 'event') return;
    // A booking changed, or the plan item it sits on was renamed or removed.
    if (m.event.type.startsWith('booking.') || m.event.type.startsWith('item.')) void load();
  });

  // Keep "in 3 hours" honest while the screen stays open, and move on once it starts.
  const startsAt = next?.booking?.startsAt;
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (startsAt && new Date(startsAt) <= now) void load();
  }, [startsAt, now, load]);

  const booking = next?.booking;
  if (!booking?.startsAt) return null;
  const meta = BOOKING_META[booking.type];
  const detail = routeOf(booking) ?? booking.reference;

  return (
    <View style={{ gap: space.sm }}>
      <Label style={{ marginTop: space.sm }}>Next up</Label>
      <Pressable
        accessibilityRole={booking.itemId ? 'button' : undefined}
        accessibilityLabel={`Next up: ${next?.itemTitle ?? titleOf(booking)}, ${relativeFrom(booking.startsAt, now)}`}
        disabled={!booking.itemId}
        onPress={() => router.push(`/trips/${tripId}/items/${booking.itemId}`)}
        style={({ pressed }) => [styles.nextUp, pressed && { opacity: 0.8 }]}
      >
        <View style={styles.nextIcon}>
          <Feather name={meta.icon} size={20} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.nextTitle} numberOfLines={1}>
            {next?.itemTitle ?? titleOf(booking)}
          </Text>
          <Text style={styles.nextWhen}>
            {formatInZone(booking.startsAt, booking.timezone)} · {relativeFrom(booking.startsAt, now)}
          </Text>
          {detail ? <Text style={styles.nextDetail}>{detail}</Text> : null}
        </View>
        {booking.itemId ? <Feather name="chevron-right" size={18} color={colors.onAccentMuted} /> : null}
      </Pressable>
    </View>
  );
}

/** A white button on the cover. Text shows beside the icon, except for Back. */
/** "Packing 12/30 · 2 to-dos left · 3 notes", opening the lists. */
function GetReadyCard() {
  const { trip } = useTrip();
  const { lists, items } = useTripLists(trip);
  const { notes } = useTripNotes(trip?.id);
  if (!trip) return null;
  const summary = lists ? listsSummary(lists, items, trip.myUserId) : null;
  const parts = summary
    ? [
        summary.packingTotal > 0 ? `Packing ${summary.packed}/${summary.packingTotal}` : null,
        summary.todosTotal > 0
          ? summary.todosLeft === 0
            ? 'To-dos all done'
            : `${summary.todosLeft} ${summary.todosLeft === 1 ? 'to-do' : 'to-dos'} left`
          : null,
        notes && notes.length > 0 ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : null,
      ].filter(Boolean)
    : [];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/trips/${trip.id}/lists`)}
      style={({ pressed }) => [styles.explore, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.exploreIcon, { backgroundColor: '#5B4E86' }]}>
        <Feather name="check-square" size={22} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.exploreTitle}>Get ready</Text>
        <Body style={{ fontSize: 13 }}>
          {parts.length > 0 ? parts.join(' · ') : 'Packing list, to-dos and notes like Wi-Fi codes and emergency numbers.'}
        </Body>
      </View>
      <Feather name="chevron-right" size={18} color="#8C867B" />
    </Pressable>
  );
}

function ActionRow(props: {
  icon: IconName;
  tint: 'accent' | 'coral';
  title: string;
  subtitle: string;
  onPress: () => void;
  last?: boolean;
}) {
  const soft = props.tint === 'coral' ? colors.coralSoft : colors.accentSoft;
  const ink = props.tint === 'coral' ? colors.coralInk : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.action, !props.last && styles.divider, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.actionIcon, { backgroundColor: soft }]}>
        <Feather name={props.icon} size={20} color={ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{props.title}</Text>
        <Body style={{ fontSize: 13 }}>{props.subtitle}</Body>
      </View>
      <Feather name="chevron-right" size={18} color="#8C867B" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  cover: { height: 230 },
  coverInner: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.lg, justifyContent: 'space-between' },
  coverTop: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },
  explore: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  exploreIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  exploreTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onPhoto: { color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  coverMeta: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  body: { padding: space.xl, gap: space.md },
  problem: { padding: space.md, borderRadius: radius.lg, backgroundColor: colors.coralSoft },
  archivedNote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 2 },
  countdown: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  divider: { borderBottomWidth: 1, borderBottomColor: '#EFEAE2' },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  nextUp: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.accent },
  nextIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  nextTitle: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  nextWhen: { fontFamily: fonts.medium, fontSize: 13, color: colors.onAccentMuted },
  nextDetail: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.5, color: '#FFFFFF' },
});
