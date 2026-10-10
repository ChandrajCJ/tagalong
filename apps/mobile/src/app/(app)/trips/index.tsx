import { TripSummary } from '@tagalong/shared';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDateRange, tripCountdown } from '@/lib/format';
import { registerForPush } from '@/lib/push';
import { colors, fonts, radius, space } from '@/theme';

const TripList = z.object({ trips: z.array(TripSummary) });

/** Your trips (design: Home.dc.html). */
export default function Trips() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request('/trips', { schema: TripList });
      setTrips(data.trips);
      setError(undefined);
      // Ask for notifications once there's a trip to be notified about.
      if (data.trips.length > 0) void registerForPush();
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

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Body>Welcome back</Body>
          <Title style={{ fontSize: 32 }}>Your trips</Title>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          onPress={() => router.push('/profile')}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>Profile</Text>
        </Pressable>
      </View>

      <FlatList
        data={trips ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          error ? (
            <View style={styles.errorBox}>
              <Body style={{ color: colors.coralInk }}>{error}</Body>
              <Button label="Try again" variant="outline" onPress={load} />
            </View>
          ) : trips && trips.length > 0 ? (
            <Label>Upcoming and planning</Label>
          ) : null
        }
        ListEmptyComponent={
          trips && !error ? (
            <View style={styles.empty}>
              <Title style={{ fontSize: 24 }}>Start your first trip</Title>
              <Body>Create a trip, invite your friends and plan it together.</Body>
            </View>
          ) : null
        }
        renderItem={({ item }) => <TripCard trip={item} />}
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
  return (
    <Link href={`/trips/${trip.id}`} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${trip.name}, ${formatDateRange(trip.startDate, trip.endDate)}`}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      >
        <View style={[styles.cover, { backgroundColor: trip.coverColor }]}>
          {countdown ? <Text style={styles.chip}>{countdown}</Text> : null}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{trip.name}</Text>
          <Body>
            {formatDateRange(trip.startDate, trip.endDate)} · {trip.destination}
          </Body>
          <Text style={styles.meta}>
            {people} · you're {trip.myRole === 'owner' ? 'the organizer' : `an ${trip.myRole}`}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.md },
  avatar: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  list: { padding: space.xl, paddingBottom: 120, gap: space.lg },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  cover: { height: 120, padding: space.md },
  chip: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', color: colors.ink, fontFamily: fonts.bold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  cardBody: { padding: space.lg, gap: 4 },
  cardTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  meta: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk, marginTop: 4 },
  empty: { paddingVertical: 60, gap: space.sm, alignItems: 'center' },
  errorBox: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.coralSoft },
  fab: { position: 'absolute', right: space.xl, bottom: 36 },
});
