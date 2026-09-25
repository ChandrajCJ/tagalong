import { Trip } from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDateRange, tripCountdown } from '@/lib/format';
import { colors, fonts, radius, space } from '@/theme';

const avatarColors = [colors.accent, colors.coral, '#5B4E86', '#7A5F14'];

/** Trip overview header (design: Trip.dc.html). The full hub arrives in week 2. */
export default function TripOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    request(`/trips/${id}`, { schema: Trip })
      .then(setTrip)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this trip'));
  }, [id]);

  if (error) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Body>{error}</Body>
        <Button label="Back to your trips" variant="outline" onPress={() => router.back()} />
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

  return (
    <View style={styles.screen}>
      <View style={[styles.cover, { backgroundColor: trip.coverColor }]}>
        <SafeAreaView edges={['top']} style={styles.coverInner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to your trips"
            onPress={() => router.back()}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={styles.title}>
              {trip.name}
            </Text>
            <View style={styles.row}>
              <View style={{ flexDirection: 'row' }}>
                {trip.members.slice(0, 4).map((m, i) => (
                  <View key={m.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar name={m.displayName} color={avatarColors[i % avatarColors.length]!} size={26} />
                  </View>
                ))}
              </View>
              <Text style={styles.coverMeta}>
                {formatDateRange(trip.startDate, trip.endDate)} · {trip.memberCount}{' '}
                {trip.memberCount === 1 ? 'traveler' : 'travelers'}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {countdown ? (
          <View style={styles.card}>
            <Text style={styles.countdown}>{countdown}</Text>
            <Body>{trip.destination}</Body>
          </View>
        ) : null}

        <Label>Travelers</Label>
        <View style={styles.card}>
          {trip.members.map((m, i) => (
            <View key={m.userId} style={[styles.memberRow, i > 0 && styles.divider]}>
              <Avatar name={m.displayName} color={avatarColors[i % avatarColors.length]!} size={34} />
              <Text style={styles.memberName}>{m.displayName}</Text>
              <Body style={{ fontSize: 13 }}>{m.role === 'owner' ? 'Organizer' : m.role}</Body>
            </View>
          ))}
        </View>

        <View style={styles.next}>
          <Text style={styles.nextTitle}>Coming next</Text>
          <Body>Invites, the shared day-by-day plan and group chat are built in the next steps.</Body>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  cover: { height: 240 },
  coverInner: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.lg, justifyContent: 'space-between' },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  backText: { fontSize: 28, lineHeight: 30, color: colors.ink, fontFamily: fonts.bold },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coverMeta: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  body: { padding: space.xl, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 2 },
  countdown: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  memberName: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  next: { marginTop: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.accentSoft, gap: 4 },
  nextTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.accentInk },
});
