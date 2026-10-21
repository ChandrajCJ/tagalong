import Feather from '@expo/vector-icons/Feather';
import { LiveLocation, LiveLocationList, LocationStopped, SHARE_CHOICES, timeLeft, type ShareChoice } from '@tagalong/shared';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { request } from '@/lib/api';
import { startSharing, stopSharing, useSharing } from '@/lib/live-location';
import { useTripRealtime } from '@/lib/realtime';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button } from './ui';

const CHOICE_LABEL: Record<ShareChoice, string> = { '1h': '1 hour', '4h': '4 hours', today: 'Until the end of today' };

/** A clock that ticks every half minute, for "2 h left" and "3 min ago". */
export const useNow = (everyMs = 30_000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
};

/** "Sharing your location with Goa · 2 h left · Stop", on every screen of that trip while it's on. */
export function LiveLocationBanner({ tripId }: { tripId: string }) {
  const sharing = useSharing();
  const now = useNow();
  if (!sharing || sharing.tripId !== tripId) return null;
  return (
    <SafeAreaView edges={['bottom']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert">
        <Feather name="navigation" size={16} color={colors.onFill} />
        <Text style={styles.text} numberOfLines={2}>
          Sharing your location with {sharing.tripName} · {timeLeft(sharing.until, now)}
          {sharing.background ? '' : Platform.OS === 'web' ? ' · while this tab is open' : ' · while the app is open'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop sharing your location" onPress={() => void stopSharing()} style={styles.stop}>
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** "Share my location": for how long, and whether to carry on while the app is closed. */
export function ShareLocationSheet({ visible, trip, onClose }: { visible: boolean; trip: { id: string; name: string }; onClose: () => void }) {
  const [choice, setChoice] = useState<ShareChoice>('1h');
  const [whileClosed, setWhileClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    if (visible) setProblem(undefined);
  }, [visible]);

  const start = async () => {
    setBusy(true);
    const result = await startSharing(trip, choice, whileClosed).catch(() => ({ error: 'Couldn’t start sharing. Try again.' }));
    setBusy(false);
    if ('error' in result) return setProblem(result.error);
    if (whileClosed && !result.background) {
      return setProblem('Sharing is on while the app is open. To carry on while it’s closed, allow location “all the time” in the phone’s settings.');
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text accessibilityRole="header" style={styles.title}>
          Share my location
        </Text>
        <Body style={{ fontSize: 13 }}>
          People on {trip.name} see where you are on the trip map, so you can find each other. It stops on its own; you can stop
          it any time. Your location is never saved, only your latest spot while you share.
        </Body>
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="For how long">
          {SHARE_CHOICES.map((c) => {
            const on = c === choice;
            return (
              <Pressable key={c} accessibilityRole="radio" aria-checked={on} onPress={() => setChoice(c)} style={[styles.choice, on && styles.choiceOn]}>
                <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? colors.accent : colors.faint} />
                <Text style={styles.choiceText}>{CHOICE_LABEL[c]}</Text>
              </Pressable>
            );
          })}
        </View>
        {Platform.OS === 'web' ? (
          <Body style={{ fontSize: 13 }}>In the browser, sharing works only while this tab stays open.</Body>
        ) : (
          <View style={styles.setting}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.settingTitle}>Keep sharing while the app is closed</Text>
              <Body style={{ fontSize: 12 }}>
                Needs location “all the time”. Android shows a notification while it’s on. Otherwise sharing pauses when you
                leave the app.
              </Body>
            </View>
            <Switch
              accessibilityLabel="Keep sharing while the app is closed"
              value={whileClosed}
              onValueChange={setWhileClosed}
              trackColor={{ true: colors.accent, false: colors.lineStrong }}
            />
          </View>
        )}
        {problem ? (
          <Body style={{ color: colors.coralInk }} accessibilityLiveRegion="polite">
            {problem}
          </Body>
        ) : null}
        <Button label="Start sharing" onPress={() => void start()} loading={busy} />
        <Button label="Cancel" variant="ghost" onPress={onClose} />
      </SafeAreaView>
    </Modal>
  );
}

/** Everyone sharing their location on the trip, kept live; positions past their time drop off. */
export function useTripLocations(tripId: string) {
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const now = useNow(60_000);

  const load = useCallback(() => {
    void request(`/trips/${tripId}/locations`, { schema: LiveLocationList })
      .then((d) => setLocations(d.locations))
      .catch(() => undefined);
  }, [tripId]);

  useEffect(load, [load]);

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return load();
    if (m.kind !== 'event') return;
    if (m.event.type === 'location.updated') {
      const parsed = LiveLocation.safeParse(m.event.payload);
      if (parsed.success) setLocations((prev) => [...prev.filter((l) => l.userId !== parsed.data.userId), parsed.data]);
    } else if (m.event.type === 'location.stopped' || m.event.type === 'member.left') {
      const parsed = LocationStopped.safeParse(m.event.payload);
      if (parsed.success) setLocations((prev) => prev.filter((l) => l.userId !== parsed.data.userId));
    }
  });

  return locations.filter((l) => Date.parse(l.until) > now.getTime());
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingBottom: space.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.sm, borderRadius: radius.lg, backgroundColor: colors.accent, marginBottom: 64 },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.onFill },
  stop: { minHeight: 36, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  stopText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.accent },
  choiceText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  setting: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  settingTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
