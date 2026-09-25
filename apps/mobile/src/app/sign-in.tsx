import { AuthTokens, RequestCodeInput, VerifyCodeInput } from '@tagalong/shared';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Field, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors, fonts, space } from '@/theme';

export default function SignIn() {
  const { signIn } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    const parsed = RequestCodeInput.safeParse({ email });
    if (!parsed.success) return setError('Enter a valid email address');
    setBusy(true);
    setError(undefined);
    try {
      await request('/auth/email/request-code', { method: 'POST', body: parsed.data, auth: false });
      setEmail(parsed.data.email);
      setStep('code');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const parsed = VerifyCodeInput.safeParse({ email, code, deviceName: Device.deviceName ?? undefined });
    if (!parsed.success) return setError('Enter the 6-digit code');
    setBusy(true);
    setError(undefined);
    try {
      const tokens = await request('/auth/email/verify', {
        method: 'POST',
        body: parsed.data,
        schema: AuthTokens,
        auth: false,
      });
      await signIn(tokens);
      // The protected stack switches to the signed-in screens on its own.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (step === 'code' ? setStep('email') : router.back())}
          style={styles.back}
        >
          <Body style={{ fontFamily: fonts.bold, color: colors.ink }}>‹ Back</Body>
        </Pressable>

        {step === 'email' ? (
          <View style={styles.section}>
            <Title>What's your email?</Title>
            <Body>We'll send you a 6-digit code. No password needed.</Body>
            <Field
              label="Email"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(undefined);
              }}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={sendCode}
              error={error}
              autoFocus
            />
          </View>
        ) : (
          <View style={styles.section}>
            <Title>Check your email</Title>
            <Body>
              Enter the code we sent to {email}. In development, it's printed in the API log.
            </Body>
            <Field
              label="Code"
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/\D/g, '').slice(0, 6));
                setError(undefined);
              }}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="done"
              onSubmitEditing={verify}
              error={error}
              style={styles.codeInput}
              autoFocus
            />
            <Button label="Send a new code" variant="ghost" onPress={sendCode} disabled={busy} />
          </View>
        )}

        <View style={{ flex: 1 }} />
        <Button
          label={step === 'email' ? 'Send code' : 'Sign in'}
          onPress={step === 'email' ? sendCode : verify}
          loading={busy}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.xl },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  section: { gap: space.md },
  codeInput: { fontFamily: fonts.bold, fontSize: 24, letterSpacing: 8 },
});
