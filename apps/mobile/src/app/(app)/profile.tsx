import Feather from '@expo/vector-icons/Feather';
import { Me, NotificationPrefs, REMINDER_LEADS, UPI_ID, type NotificationKind } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationToggles } from '@/components/notification-toggles';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { remindersAvailable, syncReminders } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { colors, fonts, radius, space } from '@/theme';

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
                      <Text style={[styles.leadText, on && { color: '#FFFFFF' }]}>{m < 60 ? `${m} min` : `${m / 60} h`} before</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
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
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
});
