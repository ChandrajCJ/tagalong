import Feather from '@expo/vector-icons/Feather';
import { Invite, InviteList, type CreateInviteInput } from '@tagalong/shared';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type Role = NonNullable<CreateInviteInput['role']>;

/**
 * The link opens the app on the friend's phone. In Expo Go this is an exp://
 * link; in a real build it becomes tagalong://invite/<token>.
 */
const inviteUrl = (token: string) => Linking.createURL(`/invite/${token}`);

/** Invite your crew (design: Invite.dc.html). */
export default function InviteScreen() {
  const { trip } = useTrip();
  const [role, setRole] = useState<Role>('editor');
  const [singleUse, setSingleUse] = useState(false);
  const [link, setLink] = useState<string>();
  const [active, setActive] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const isOwner = trip?.myRole === 'owner';

  const loadActive = useCallback(async () => {
    if (!trip || !isOwner) return;
    const data = await request(`/trips/${trip.id}/invites`, { schema: InviteList }).catch(() => null);
    if (data) setActive(data.invites);
  }, [trip, isOwner]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  if (!trip) return null;

  const createLink = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const invite = await request(`/trips/${trip.id}/invites`, {
        method: 'POST',
        body: { role, ...(singleUse ? { maxUses: 1 } : {}) },
        schema: Invite,
      });
      setLink(inviteUrl(invite.token!));
      setCopied(false);
      await loadActive();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create a link');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
  };

  const share = async () => {
    if (!link) return;
    await Share.share({ message: `Join "${trip.name}" on Tagalong: ${link}` }).catch(() => undefined);
  };

  const revoke = (invite: Invite) =>
    Alert.alert('Turn off this link?', 'People who haven\'t joined yet won\'t be able to use it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          await request(`/trips/${trip.id}/invites/${invite.id}`, { method: 'DELETE' }).catch(() => undefined);
          await loadActive();
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.close}>
          <Body style={{ fontFamily: fonts.bold, color: colors.ink }}>Done</Body>
        </Pressable>

        <View style={{ gap: space.sm }}>
          <Title>Invite your crew</Title>
          <Body>Anyone with the link can join {trip.name}. Links work for 7 days.</Body>
        </View>

        <View style={{ gap: space.sm }}>
          <Label>They'll join as</Label>
          <View style={styles.segment}>
            {(['editor', 'viewer'] as const).map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                aria-checked={role === r}
                onPress={() => {
                  setRole(r);
                  setLink(undefined);
                }}
                style={[styles.segmentItem, role === r && styles.segmentOn]}
              >
                <Text style={[styles.segmentTitle, role === r && { color: colors.ink }]}>
                  {r === 'editor' ? 'Editor' : 'Viewer'}
                </Text>
                <Text style={styles.segmentSub}>
                  {r === 'editor' ? 'Can plan and chat' : 'Can only look'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="switch"
          aria-checked={singleUse}
          onPress={() => {
            setSingleUse((v) => !v);
            setLink(undefined);
          }}
          style={styles.toggle}
        >
          <Feather
            name={singleUse ? 'check-square' : 'square'}
            size={20}
            color={singleUse ? colors.accent : colors.lineStrong}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>One person only</Text>
            <Body style={{ fontSize: 13 }}>
              {singleUse
                ? 'The link stops working after the first person joins.'
                : 'Anyone with the link can join, until you turn it off.'}
            </Body>
          </View>
        </Pressable>

        {link ? (
          <View style={{ gap: space.md }}>
            <View style={styles.linkBox}>
              <Text style={styles.linkText} numberOfLines={2} selectable>
                {link}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button
                label={copied ? 'Copied' : 'Copy link'}
                variant="outline"
                onPress={copy}
                style={{ flex: 1 }}
                icon={<Feather name={copied ? 'check' : 'copy'} size={18} color={colors.ink} />}
              />
              <Button
                label="Share"
                onPress={share}
                style={{ flex: 1 }}
                icon={<Feather name="share" size={18} color="#FFFFFF" />}
              />
            </View>
          </View>
        ) : (
          <Button label="Create invite link" onPress={createLink} loading={busy} />
        )}
        {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}

        {isOwner && active.length > 0 ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Label>Active links · {active.length}</Label>
            <View style={styles.list}>
              {active.map((inv, i) => (
                <View key={inv.id} style={[styles.inviteRow, i > 0 && styles.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteTitle}>
                      {inv.role === 'editor' ? 'Editor link' : 'Viewer link'} · by {inv.createdByName}
                    </Text>
                    <Body style={{ fontSize: 13 }}>
                      {inv.maxUses === 1 ? 'One person only · ' : ''}used {inv.useCount}{' '}
                      {inv.useCount === 1 ? 'time' : 'times'} · expires{' '}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </Body>
                  </View>
                  <Button label="Turn off" variant="ghost" onPress={() => revoke(inv)} style={{ minHeight: 44, paddingHorizontal: space.sm }} />
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.lg },
  close: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  segment: { flexDirection: 'row', gap: space.sm },
  segmentItem: { flex: 1, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, gap: 2 },
  segmentOn: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  segmentTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.muted },
  segmentSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  toggle: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 44 },
  toggleTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  linkBox: { padding: space.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  inviteTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
});
