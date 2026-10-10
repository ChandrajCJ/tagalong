import Feather from '@expo/vector-icons/Feather';
import { Me, UPI_ID } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Field, Label, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
});
