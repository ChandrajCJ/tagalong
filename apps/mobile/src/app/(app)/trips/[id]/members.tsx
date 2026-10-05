import Feather from '@expo/vector-icons/Feather';
import { hasRole, type TripMember, type TripRole } from '@tagalong/shared';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

const ROLE_LABEL: Record<TripRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

/** Everyone on the trip. Owners manage roles; anyone can leave. */
export default function Members() {
  const { trip, reload } = useTrip();
  if (!trip) return null;

  const isOwner = trip.myRole === 'owner';

  const showError = (e: unknown) =>
    Alert.alert("That didn't work", e instanceof ApiError ? e.message : 'Something went wrong');

  const setRole = async (member: TripMember, role: TripRole) => {
    try {
      await request(`/trips/${trip.id}/members/${member.userId}`, { method: 'PATCH', body: { role } });
      await reload();
    } catch (e) {
      showError(e);
    }
  };

  const remove = async (member: TripMember) => {
    try {
      await request(`/trips/${trip.id}/members/${member.userId}`, { method: 'DELETE' });
      await reload();
    } catch (e) {
      showError(e);
    }
  };

  const manage = (member: TripMember) => {
    const roleOptions = (['owner', 'editor', 'viewer'] as const)
      .filter((r) => r !== member.role)
      .map((r) => ({ text: `Make ${ROLE_LABEL[r].toLowerCase()}`, onPress: () => void setRole(member, r) }));
    Alert.alert(member.displayName, `Currently ${ROLE_LABEL[member.role].toLowerCase()}`, [
      ...roleOptions,
      {
        text: 'Remove from trip',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Remove ${member.displayName}?`, 'They lose access to the plan and chat.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => void remove(member) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const leave = () =>
    Alert.alert(`Leave ${trip.name}?`, "You'll need a new invite to come back.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await request(`/trips/${trip.id}/members/${trip.myUserId}`, { method: 'DELETE' });
            router.replace('/trips');
          } catch (e) {
            showError(e);
          }
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Title>Travelers</Title>
        <Body>
          {trip.memberCount} {trip.memberCount === 1 ? 'person' : 'people'} on {trip.name}.
          {isOwner ? ' Tap someone to change their role.' : ''}
        </Body>

        <View style={styles.list}>
          {trip.members.map((m, i) => {
            const isMe = m.userId === trip.myUserId;
            const canManage = isOwner && !isMe;
            return (
              <Pressable
                key={m.userId}
                accessibilityRole={canManage ? 'button' : undefined}
                accessibilityLabel={`${m.displayName}${isMe ? ' (you)' : ''}, ${ROLE_LABEL[m.role]}`}
                disabled={!canManage}
                onPress={() => manage(m)}
                style={[styles.row, i > 0 && styles.divider]}
              >
                <Avatar name={m.displayName} color={avatarColor(i)} size={36} />
                <Text style={styles.name}>
                  {m.displayName}
                  {isMe ? <Text style={styles.you}> (you)</Text> : null}
                </Text>
                <Text style={[styles.role, m.role === 'owner' && { color: colors.accentInk }]}>
                  {ROLE_LABEL[m.role]}
                </Text>
                {canManage ? <Feather name="more-horizontal" size={18} color="#8C867B" /> : null}
              </Pressable>
            );
          })}
        </View>

        {hasRole(trip.myRole, 'editor') ? (
          <Button
            label="Invite people"
            variant="outline"
            onPress={() => router.push(`/trips/${trip.id}/invite`)}
            icon={<Feather name="user-plus" size={18} color={colors.ink} />}
          />
        ) : null}

        <Label style={{ marginTop: space.lg }}>Roles</Label>
        <Body style={{ fontSize: 13 }}>
          Owners manage people. Editors plan, chat and invite. Viewers can look but not change anything.
        </Body>

        <Button label="Leave trip" variant="ghost" onPress={leave} style={{ marginTop: space.lg }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.md },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  you: { fontFamily: fonts.body, color: colors.muted },
  role: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
});
