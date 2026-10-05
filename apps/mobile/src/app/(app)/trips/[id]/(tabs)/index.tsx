import Feather from '@expo/vector-icons/Feather';
import { hasRole } from '@tagalong/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { formatDateRange, tripCountdown } from '@/lib/format';
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
            last
          />
        </View>
      </ScrollView>
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
});
