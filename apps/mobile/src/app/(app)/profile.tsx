import Feather from '@expo/vector-icons/Feather';
import { JOURNAL_TIMES, Me, NotificationPrefs, REMINDER_LEADS, UPI_ID, type NotificationKind } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarLink } from '@/components/calendar-link';
import { NotificationToggles } from '@/components/notification-toggles';
import { Avatar, Body, Button, Field, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { chooseAppearance } from '@/lib/appearance';
import { pickAvatar, removeAvatar, uploadAvatar } from '@/lib/avatars';
import { remindersAvailable, syncReminders } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { appearanceChoice, avatarColor, colors, fonts, radius, space, type AppearanceChoice } from '@/theme';

/** Your name as friends see it, and the UPI ID they can pay you back on. */
export default function ProfileScreen() {
  const { signOut } = useSession();
  const [me, setMe] = useState<Me>();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [errors, setErrors] = useState<{ name?: string; upi?: string }>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [prefs, setPrefs] = useState<NotificationPrefs>();
  useEffect(() => {
    void request('/me/notifications', { schema: NotificationPrefs })
      .then(setPrefs)
      .catch(() => undefined);
  }, []);
  /** Notification settings save straight away too; reminders reschedule to match. */
  const changePrefs = async (changes: Partial<NotificationPrefs>) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, ...changes });
    try {
      setPrefs(await request('/me/notifications', { method: 'PATCH', body: changes, schema: NotificationPrefs }));
      if ('reminders' in changes || 'reminderMinutes' in changes) void syncReminders();
    } catch {
      setPrefs(before);
      setNotice('Couldn’t change that. Try again.');
    }
  };

  /** Saved straight away, like a phone's own settings. */
  const setReadReceipts = async (on: boolean) => {
    if (!me) return;
    setMe({ ...me, readReceipts: on });
    try {
      setMe(await request('/me', { method: 'PATCH', body: { readReceipts: on }, schema: Me }));
    } catch {
      setMe({ ...me, readReceipts: !on });
      setNotice('Couldn’t change that. Try again.');
    }
  };

  useEffect(() => {
    request('/me', { schema: Me })
      .then((data) => {
        setMe(data);
        setName(data.displayName);
        setUpi(data.upiId ?? '');
      })
      .catch(() => setNotice('Could not load your profile'));
  }, []);

  const save = async () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter your name';
    const upiText = upi.trim();
    if (upiText && !UPI_ID.safeParse(upiText).success) next.upi = 'Use a UPI ID like name@okaxis';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const saved = await request('/me', {
        method: 'PATCH',
        body: { displayName: name.trim(), upiId: upiText ? upiText : null },
        schema: Me,
      });
      setMe(saved);
      setUpi(saved.upiId ?? '');
      setNotice('Saved');
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  // Profile photo: chosen or taken, cropped square on the phone, saved straight away.
  const [photoBusy, setPhotoBusy] = useState(false);
  const changePhoto = async (from: 'library' | 'camera' | 'remove') => {
    setPhotoBusy(true);
    setNotice(undefined);
    try {
      if (from === 'remove') setMe(await removeAvatar());
      else {
        const uri = await pickAvatar(from);
        if (uri) setMe(await uploadAvatar(uri));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Couldn’t change your photo. Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You can sign back in any time with your email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.close}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>

          <Title>Your profile</Title>
          {me ? <Body>{me.email}</Body> : null}

          {notice ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Feather name={notice === 'Saved' ? 'check' : 'info'} size={16} color={colors.accentInk} />
              <Body style={{ flex: 1, color: colors.accentInk }}>{notice}</Body>
            </View>
          ) : null}

          {me ? (
            <View style={styles.photoRow}>
              <Avatar
                name={me.displayName}
                color={avatarColor(0)}
                size={88}
                userId={me.id}
                photo={me.avatarUrl && me.avatarVersion ? { url: me.avatarUrl, version: me.avatarVersion } : null}
              />
              <View style={{ flex: 1, gap: space.xs }}>
                <Button
                  label={me.avatarUrl ? 'Change photo' : 'Choose a photo'}
                  variant="outline"
                  onPress={() => void changePhoto('library')}
                  loading={photoBusy}
                  style={{ minHeight: 40 }}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <Button label="Take one" variant="ghost" onPress={() => void changePhoto('camera')} disabled={photoBusy} style={{ minHeight: 36 }} />
                  {me.avatarUrl ? (
                    <Button label="Remove" variant="ghost" onPress={() => void changePhoto('remove')} disabled={photoBusy} style={{ minHeight: 36 }} />
                  ) : null}
                </View>
                <Body style={{ fontSize: 12 }}>Only people on your trips see it.</Body>
              </View>
            </View>
          ) : null}

          <Field
            label="Your name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setNotice(undefined);
            }}
            placeholder="Priya"
            maxLength={60}
            error={errors.name}
          />

          <View style={{ gap: space.sm }}>
            <Field
              label="UPI ID (optional)"
              value={upi}
              onChangeText={(v) => {
                setUpi(v);
                setNotice(undefined);
              }}
              placeholder="name@okaxis"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              error={errors.upi}
            />
            <Body style={{ fontSize: 13 }}>
              On a trip kept in rupees, friends who owe you get a “Pay with UPI” button that opens their
              UPI app with your ID and the amount filled in. Only people on your trips can see it.
            </Body>
          </View>

          <Button label="Save" onPress={save} loading={busy} disabled={!me} />

          <View style={{ gap: space.sm, marginTop: space.xl }}>
            <Label>Notifications</Label>
            <Body style={{ fontSize: 13 }}>
              What you’re told about on every trip. Each trip’s ⋯ menu can change these for that trip, or mute it.
            </Body>
            {prefs ? (
              <NotificationToggles
                prefs={prefs}
                onChange={(kind: NotificationKind, on) => void changePrefs({ [kind]: on })}
              />
            ) : null}
            {prefs?.journal ? (
              <View style={{ gap: space.xs }}>
                <Text style={styles.settingTitle}>Journal prompt time</Text>
                <View style={styles.leads} accessibilityRole="radiogroup" accessibilityLabel="When the journal prompt comes">
                  {JOURNAL_TIMES.map((t) => {
                    const on = prefs.journalTime === t;
                    return (
                      <Pressable
                        key={t}
                        accessibilityRole="radio"
                        aria-checked={on}
                        onPress={() => void changePrefs({ journalTime: t })}
                        style={[styles.lead, on && styles.leadOn]}
                      >
                        <Text style={[styles.leadText, on && { color: colors.onFill }]}>{t}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Body style={{ fontSize: 12 }}>On the trip’s own clock, wherever you are.</Body>
              </View>
            ) : null}
            <View style={styles.setting}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.settingTitle}>Reminders before timed stops</Text>
                <Body style={{ fontSize: 13 }}>
                  {remindersAvailable
                    ? '“Lunch at Fisherman’s Wharf in 30 min”, set on this phone, so they work offline. Flights get at least 3 hours.'
                    : 'Reminders only work in the phone app; the web app can’t set them.'}
                </Body>
              </View>
              <Switch
                accessibilityLabel="Reminders before timed stops"
                value={prefs?.reminders ?? true}
                disabled={!prefs || !remindersAvailable}
                onValueChange={(on) => void changePrefs({ reminders: on })}
                trackColor={{ true: colors.accent, false: colors.lineStrong }}
              />
            </View>
            {prefs?.reminders && remindersAvailable ? (
              <View style={styles.leads} accessibilityRole="radiogroup" accessibilityLabel="How long before">
                {REMINDER_LEADS.map((m) => {
                  const on = prefs.reminderMinutes === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => void changePrefs({ reminderMinutes: m })}
                      style={[styles.lead, on && styles.leadOn]}
                    >
                      <Text style={[styles.leadText, on && { color: colors.onFill }]}>{m < 60 ? `${m} min` : `${m / 60} h`} before</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>

          {me ? (
            <View style={{ gap: space.sm, marginTop: space.xl }}>
              <Label>Calendar</Label>
              <CalendarLink userId={me.id} />
            </View>
          ) : null}

          <View style={{ gap: space.sm, marginTop: space.xl }}>
            <Label>Appearance</Label>
            <View style={styles.leads} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
              {(
                [
                  ['system', 'Like my phone'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ] as [AppearanceChoice, string][]
              ).map(([value, label]) => {
                const on = appearanceChoice === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    aria-checked={on}
                    onPress={() => (on ? undefined : void chooseAppearance(value))}
                    style={[styles.lead, on && styles.leadOn]}
                  >
                    <Text style={[styles.leadText, on && { color: colors.onFill }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Body style={{ fontSize: 13 }}>The app restarts for a moment to switch.</Body>
          </View>

          <View style={{ gap: space.sm, marginTop: space.xl }}>
            <Label>Privacy</Label>
            <View style={styles.setting}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.settingTitle}>Read receipts</Text>
                <Body style={{ fontSize: 13 }}>
                  Others see when you’ve read their messages (✓✓ in green). Turn it off and you won’t see when they’ve
                  read yours either. “Delivered” ticks always show.
                </Body>
              </View>
              <Switch
                accessibilityLabel="Read receipts"
                value={me?.readReceipts ?? true}
                disabled={!me}
                onValueChange={(on) => void setReadReceipts(on)}
                trackColor={{ true: colors.accent, false: colors.lineStrong }}
              />
            </View>
            <Body style={{ fontSize: 13 }}>
              Your profile photo shows only to people on your trips. Your calendar link (under Calendar) lets whoever has it
              see your trip plans; it’s off until you turn it on, and Stop sharing ends it at once. Your live location is
              shared only when you start it from a trip’s map, with that trip, for the time you pick; it’s never saved.
            </Body>
          </View>

          <View style={{ gap: space.sm, marginTop: space.xl }}>
            <Label>Account</Label>
            <Button label="Sign out" variant="outline" onPress={confirmSignOut} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.lg },
  close: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  closeText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  setting: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  leads: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  lead: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, justifyContent: 'center' },
  leadOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  leadText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  settingTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
});
