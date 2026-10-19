import Feather from '@expo/vector-icons/Feather';
import { MUTED_FOREVER, TripNotifications, type NotificationKind } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationToggles } from '@/components/notification-toggles';
import { Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

const HOUR = 60 * 60 * 1000;

/** "Muted until Sat 14:00", or "Muted until you turn it back on". */
const mutedLabel = (until: string) =>
  new Date(until).getFullYear() >= new Date(MUTED_FOREVER).getFullYear()
    ? 'Muted until you turn it back on'
    : `Muted until ${new Date(until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`;

/** The trip ⋯ menu → Notifications: mute this trip, or change what it tells you about. */
export default function TripNotificationsScreen() {
  const { trip } = useTrip();
  const [state, setState] = useState<TripNotifications>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!trip) return;
    void request(`/trips/${trip.id}/notifications`, { schema: TripNotifications })
      .then(setState)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Couldn’t load the settings'));
  }, [trip]);

  const change = async (body: Record<string, unknown>) => {
    if (!trip) return;
    setError(undefined);
    try {
      setState(await request(`/trips/${trip.id}/notifications`, { method: 'PATCH', body, schema: TripNotifications }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t change that. Try again.');
    }
  };

  const muted = state?.effective.mutedUntil ?? null;
  const overridden = state ? Object.entries(state.overrides).some(([k, v]) => k !== 'mutedUntil' && v !== null) : false;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.close}>
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
        <Title>Notifications</Title>
        <Body>For {trip?.name ?? 'this trip'} only. Your defaults are in Profile.</Body>

        {!state ? (
          error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <View style={{ gap: space.sm }}>
              <Label>Mute</Label>
              {muted ? (
                <View style={styles.muted}>
                  <Feather name="bell-off" size={16} color={colors.accentInk} />
                  <Text style={styles.mutedText}>{mutedLabel(muted)}. @Mentions still get through.</Text>
                </View>
              ) : null}
              <View style={styles.row}>
                {[
                  { label: 'For 1 day', until: () => new Date(Date.now() + 24 * HOUR).toISOString() },
                  { label: 'For 1 week', until: () => new Date(Date.now() + 7 * 24 * HOUR).toISOString() },
                  { label: 'Until I turn it back on', until: () => MUTED_FOREVER },
                ].map((o) => (
                  <Button key={o.label} label={o.label} variant="outline" onPress={() => void change({ mutedUntil: o.until() })} style={{ minHeight: 40 }} />
                ))}
                {muted ? <Button label="Unmute" onPress={() => void change({ mutedUntil: null })} style={{ minHeight: 40 }} /> : null}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <Label>On this trip, tell me about</Label>
              <NotificationToggles
                prefs={state.effective}
                onChange={(kind: NotificationKind, on) => void change({ [kind]: on })}
              />
              {overridden ? (
                <Button
                  label="Use my defaults"
                  variant="ghost"
                  onPress={() => void change({ chat: null, mentions: null, plan: null, money: null, todos: null, trip: null })}
                />
              ) : null}
            </View>
            {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.lg },
  close: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  closeText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  muted: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  mutedText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.accentInk },
});
