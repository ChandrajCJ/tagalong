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

const ROLES: { role: Role; title: string; can: string }[] = [
  { role: 'editor', title: 'Editors', can: 'Can plan, chat, vote and add photos.' },
  { role: 'viewer', title: 'Viewers', can: 'Can see everything, vote and heart photos, but not change the plan.' },
];

/**
 * The link opens the app on the friend's phone. In Expo Go this is an exp://
 * link; in a real build it becomes tagalong://invite/<token>.
 */
const inviteUrl = (token: string) => Linking.createURL(`/invite/${token}`);

/** Invite your crew (design: Invite.dc.html). */
export default function InviteScreen() {
  const { trip } = useTrip();
  const [singleUse, setSingleUse] = useState(false);
  /*
   * One link per role, side by side, so some friends can join as editors and
   * others as viewers. A link is shown only once (the server keeps just a
   * fingerprint of it), so each is held here for as long as the screen is open.
   */
  const [links, setLinks] = useState<Partial<Record<Role, { url: string; singleUse: boolean }>>>({});
  const [active, setActive] = useState<Invite[]>([]);
  const [busy, setBusy] = useState<Role | null>(null);
  const [copied, setCopied] = useState<Role | null>(null);
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

  const createLink = async (role: Role) => {
    setBusy(role);
    setError(undefined);
    try {
      const invite = await request(`/trips/${trip.id}/invites`, {
        method: 'POST',
        body: { role, ...(singleUse ? { maxUses: 1 } : {}) },
        schema: Invite,
      });
      setLinks((prev) => ({ ...prev, [role]: { url: inviteUrl(invite.token!), singleUse } }));
      setCopied(null);
      await loadActive();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create a link');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (role: Role) => {
    const link = links[role];
    if (!link) return;
    await Clipboard.setStringAsync(link.url);
    setCopied(role);
  };

  const share = async (role: Role) => {
    const link = links[role];
    if (!link) return;
    const as = role === 'editor' ? 'to help plan' : 'to follow along';
    await Share.share({ message: `Join "${trip.name}" on Tagalong ${as}: ${link.url}` }).catch(
      () => undefined,
    );
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
          <Body>
            Make a link for each kind of guest and send each to the right people. Links work for
            7 days.
          </Body>
        </View>

        <Pressable
          accessibilityRole="switch"
          aria-checked={singleUse}
          onPress={() => setSingleUse((v) => !v)}
          style={styles.toggle}
        >
          <Feather
            name={singleUse ? 'check-square' : 'square'}
            size={20}
            color={singleUse ? colors.accent : colors.lineStrong}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>One person per link</Text>
            <Body style={{ fontSize: 13 }}>
              {singleUse
                ? 'New links stop working after the first person joins.'
                : 'Anyone with a link can join, until you turn it off.'}
            </Body>
          </View>
        </Pressable>

        {ROLES.map(({ role, title, can }) => {
          const link = links[role];
          return (
            <View key={role} style={styles.roleCard}>
              <View style={{ gap: 2 }}>
                <Text style={styles.roleTitle}>{title}</Text>
                <Body style={{ fontSize: 13 }}>{can}</Body>
              </View>
              {link ? (
                <>
                  <View style={styles.linkBox}>
                    <Text style={styles.linkText} numberOfLines={2} selectable>
                      {link.url}
                    </Text>
                    {link.singleUse ? <Text style={styles.linkTag}>One person only</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: space.md }}>
                    <Button
                      label={copied === role ? 'Copied' : 'Copy'}
                      variant="outline"
                      onPress={() => void copy(role)}
                      style={{ flex: 1 }}
                      icon={<Feather name={copied === role ? 'check' : 'copy'} size={18} color={colors.ink} />}
                    />
                    <Button
                      label="Share"
                      onPress={() => void share(role)}
                      style={{ flex: 1 }}
                      icon={<Feather name="share" size={18} color="#FFFFFF" />}
                    />
                  </View>
                </>
              ) : (
                <Button
                  label={`Create ${role} link`}
                  variant={role === 'editor' ? 'primary' : 'outline'}
                  onPress={() => void createLink(role)}
                  loading={busy === role}
                  disabled={busy !== null && busy !== role}
                />
              )}
            </View>
          );
        })}

        <Body style={{ fontSize: 13 }}>
          Changed your mind about someone? An owner can switch anyone between editor and viewer
          in Members, any time.
        </Body>

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
  roleCard: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  roleTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  linkTag: { marginTop: 4, fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
  toggle: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 44 },
  toggleTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  linkBox: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  linkText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
  divider: { borderTopWidth: 1, borderTopColor: '#EFEAE2' },
  inviteTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
});
