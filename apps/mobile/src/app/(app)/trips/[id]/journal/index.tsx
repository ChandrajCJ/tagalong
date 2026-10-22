import Feather from '@expo/vector-icons/Feather';
import { JournalDays, tripOver } from '@tagalong/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { spokenDate, todayIso } from '@/lib/dates';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

/** The trip journal: one page per day, with who's written on each. */
export default function JournalDaysScreen() {
  const { trip } = useTrip();
  const [days, setDays] = useState<JournalDays['days'] | null>(null);
  const [error, setError] = useState<string>();
  const tripId = trip?.id;

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      setDays((await request(`/trips/${tripId}/journal`, { schema: JournalDays })).days);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load the journal');
    }
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected' || (m.kind === 'event' && m.event.type === 'journal.updated')) void load();
  });

  if (!trip) return null;
  const today = todayIso();
  const over = tripOver(trip, today);
  const indexOf = (userId: string) => Math.max(0, trip.members.findIndex((m) => m.userId === userId));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.head}>
        <Title>Journal</Title>
        <Body>Each day of {trip.name}, filled in from the plan, photos and chat. Add what you want to remember.</Body>
      </View>

      {error && !days ? (
        <View style={styles.center}>
          <Body>{error}</Body>
          <Button label="Try again" variant="outline" onPress={load} />
        </View>
      ) : !days ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : days.length === 0 ? (
        <View style={styles.center}>
          <Body style={{ textAlign: 'center' }}>Add the trip’s dates and each day gets a page here.</Body>
          {trip.myRole !== 'viewer' ? <Button label="Add dates" variant="outline" onPress={() => router.push(`/trips/${trip.id}/edit`)} /> : null}
        </View>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.date}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            over ? (
              <Pressable accessibilityRole="button" onPress={() => router.push(`/trips/${trip.id}/recap`)} style={styles.recap}>
                <Feather name="star" size={18} color={colors.onFill} />
                <Text style={styles.recapText}>See the trip recap</Text>
                <Feather name="chevron-right" size={18} color={colors.onFill} />
              </Pressable>
            ) : null
          }
          renderItem={({ item: d }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${d.dayNumber ? `Day ${d.dayNumber}, ` : ''}${spokenDate(d.date)}, ${d.entryCount} ${d.entryCount === 1 ? 'entry' : 'entries'}`}
              onPress={() => router.push(`/trips/${trip.id}/journal/${d.date}`)}
              style={[styles.day, d.date === today && styles.today]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.dayTitle}>
                  {[d.dayNumber ? `Day ${d.dayNumber}` : null, d.city].filter(Boolean).join(' · ') || spokenDate(d.date)}
                  {d.date === today ? <Text style={styles.todayTag}>  Today</Text> : null}
                </Text>
                <Body style={{ fontSize: 13 }}>
                  {spokenDate(d.date)} · {d.entryCount === 0 ? 'nothing yet' : `${d.entryCount} ${d.entryCount === 1 ? 'entry' : 'entries'}`}
                </Body>
              </View>
              <View style={styles.writers}>
                {d.writers.slice(0, 4).map((w, i) => {
                  const member = trip.members.find((m) => m.userId === w);
                  return (
                    <View key={w} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                      <Avatar name={member?.displayName ?? '?'} userId={w} color={avatarColor(indexOf(w))} size={24} />
                    </View>
                  );
                })}
              </View>
              <Feather name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', paddingHorizontal: space.md, paddingTop: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: space.xl, gap: space.xs, paddingBottom: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  list: { padding: space.xl, paddingTop: 0, gap: space.sm },
  recap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, marginBottom: space.sm, borderRadius: radius.lg, backgroundColor: colors.accent },
  recapText: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.onFill },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  today: { borderColor: colors.accent },
  dayTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  todayTag: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
  writers: { flexDirection: 'row' },
});
