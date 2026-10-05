import { InvitePreview, Trip } from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDateRange } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, fonts, space } from '@/theme';

/** Opened from an invite link: tagalong://invite/<token>. */
export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { status, setPendingInvite } = useSession();
  const [preview, setPreview] = useState<InvitePreview>();
  const [error, setError] = useState<string>();
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn' || !token) return;
    setPendingInvite(null);
    request(`/invites/${token}`, { schema: InvitePreview })
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not open this invite'));
  }, [status, token, setPendingInvite]);

  const openTrip = (id: string) => router.replace(`/trips/${id}`);

  const join = async () => {
    setJoining(true);
    try {
      const trip = await request(`/invites/${token}/accept`, { method: 'POST', schema: Trip });
      openTrip(trip.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join this trip');
      setJoining(false);
    }
  };

  if (status === 'signedOut') {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Title style={styles.centerText}>You've been invited to a trip</Title>
        <Body style={styles.centerText}>Sign in to see the trip and join it.</Body>
        <Button
          label="Sign in to join"
          onPress={() => {
            setPendingInvite(token ?? null);
            router.replace('/sign-in');
          }}
          style={{ alignSelf: 'stretch' }}
        />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Title style={styles.centerText}>This link doesn't work</Title>
        <Body style={styles.centerText}>{error}</Body>
        <Button label="Go to your trips" variant="outline" onPress={() => router.replace('/trips')} />
      </SafeAreaView>
    );
  }

  if (!preview) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const people = preview.memberCount === 1 ? '1 person' : `${preview.memberCount} people`;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Body style={{ fontFamily: fonts.bold, color: colors.accent }}>
          {preview.inviterName} invited you
        </Body>
        <View style={styles.card}>
          <View style={[styles.cover, { backgroundColor: preview.coverColor }]} />
          <View style={styles.cardBody}>
            <Text style={styles.tripName}>{preview.tripName}</Text>
            <Body>
              {formatDateRange(preview.startDate, preview.endDate)} · {preview.destination}
            </Body>
            <Text style={styles.meta}>
              {people} · you'll join as {preview.role === 'editor' ? 'an editor' : 'a viewer'}
            </Text>
          </View>
        </View>
        <Body>
          {preview.role === 'editor'
            ? 'Editors can plan, chat and add expenses.'
            : 'Viewers can see the plan and photos but not change them.'}
        </Body>
      </View>

      <View style={styles.footer}>
        {preview.alreadyMember ? (
          <Button label="You're already in. Open trip" onPress={() => openTrip(preview.tripId)} />
        ) : (
          <>
            <Button label={`Join ${preview.tripName}`} onPress={join} loading={joining} />
            <Button label="Not now" variant="ghost" onPress={() => router.replace('/trips')} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
  centerText: { textAlign: 'center' },
  body: { flex: 1, padding: space.xl, gap: space.lg, justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  cover: { height: 140 },
  cardBody: { padding: space.lg, gap: 4 },
  tripName: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  meta: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk, marginTop: 4 },
  footer: { padding: space.xl, gap: space.sm },
});
