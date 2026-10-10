import Feather from '@expo/vector-icons/Feather';
import { hasRole, NextUp } from '@tagalong/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { request } from '@/lib/api';
import { BOOKING_META, formatInZone, relativeFrom, routeOf, titleOf } from '@/lib/bookings';
import { formatDateRange, tripCountdown } from '@/lib/format';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Trip overview, the hub (design: Trip.dc.html). */
export default function TripOverview() {
  const { trip, error, reload } = useTrip();

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
  const base = `/trips/${trip.id}` as const;

  return (
    <View style={styles.screen}>
      <View style={[styles.cover, { backgroundColor: trip.coverColor }]}>
        <SafeAreaView edges={['top']} style={styles.coverInner}>
          <View style={styles.coverTop}>
            <RoundButton icon="chevron-left" label="Back to your trips" onPress={() => router.replace('/trips')} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {canInvite ? (
                <RoundButton icon="user-plus" label="Invite people" onPress={() => router.push(`${base}/invite`)} />
              ) : null}
              <RoundButton icon="users" label="Members" onPress={() => router.push(`${base}/members`)} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={styles.title}>
              {trip.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${trip.memberCount} travelers. See members`}
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
              <Text style={styles.coverMeta}>
                {formatDateRange(trip.startDate, trip.endDate)} · {trip.memberCount}{' '}
                {trip.memberCount === 1 ? 'traveler' : 'travelers'}
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.countdown}>{countdown ?? 'No dates yet'}</Text>
          <Body>{trip.destination}</Body>
        </View>

        <NextUpCard tripId={trip.id} />

        <Label style={{ marginTop: space.sm }}>Get ready</Label>
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
            title="Start the day-by-day plan"
            subtitle="Add places, times and who's doing what"
            onPress={() => router.push(`${base}/plan`)}
          />
          <ActionRow
            icon="message-square"
            tint="accent"
            title="Talk it over"
            subtitle="Chat with everyone on the trip"
            onPress={() => router.push(`${base}/chat`)}
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

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.round}>
      <Feather name={icon} size={20} color={colors.ink} />
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
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverMeta: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  body: { padding: space.xl, gap: space.md },
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
