import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { colors, fonts, radius, space } from '@/theme';

/** Welcome screen (design: Main.dc.html). */
export default function Welcome() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>T</Text>
        </View>
        <Text style={styles.brandName}>Tagalong</Text>
      </View>

      <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.photoCard}>
          <Text style={styles.photoChip}>142 photos</Text>
        </View>
        <View style={styles.planCard}>
          <Text style={styles.planDay}>Fri · Day 2</Text>
          {[
            ['10:00', 'Pena Palace'],
            ['13:00', 'Lunch in Sintra'],
            ['18:00', 'Sunset boat tour'],
          ].map(([time, what]) => (
            <View key={time} style={styles.planRow}>
              <Text style={styles.planTime}>{time}</Text>
              <Text style={styles.planWhat}>{what}</Text>
            </View>
          ))}
        </View>
        <View style={styles.chatCard}>
          <Text style={styles.chatText}>
            <Text style={{ fontFamily: fonts.bold }}>Priya </Text>Boat tour Friday at 6?
          </Text>
          <Text style={styles.chatChip}>+ Add to plan</Text>
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Text accessibilityRole="header" style={styles.headline}>
          Plan together.{'\n'}Travel together.{'\n'}Remember together.
        </Text>
        <Text style={styles.sub}>One shared space for your group's plans, chat, money and photos.</Text>
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ gap: space.md }}>
        <Button label="Continue with email" variant="light" onPress={() => router.push('/sign-in')} />
        <Button label="Apple and Google sign-in coming soon" variant="outlineLight" disabled />
        <Text style={styles.legal}>By continuing you agree to the Terms and Privacy Policy.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.accent, paddingHorizontal: 24, paddingTop: space.xl, paddingBottom: space.lg, gap: space.xxl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  brandName: { fontFamily: fonts.display, fontSize: 22, color: '#FFFFFF' },
  preview: { height: 230 },
  photoCard: { position: 'absolute', right: 0, top: 0, width: 140, height: 176, borderRadius: radius.lg, backgroundColor: '#D8A47F', justifyContent: 'flex-end', padding: 10 },
  photoChip: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', color: colors.ink, fontFamily: fonts.bold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  planCard: { position: 'absolute', left: 0, top: 24, width: 210, padding: 14, borderRadius: radius.lg, backgroundColor: '#FFFFFF', gap: 8 },
  planDay: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  planRow: { flexDirection: 'row', gap: 10 },
  planTime: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink, width: 42 },
  planWhat: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  chatCard: { position: 'absolute', left: 36, bottom: 0, width: 240, padding: 12, borderRadius: radius.lg, backgroundColor: colors.bg, gap: 8 },
  chatText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  chatChip: { alignSelf: 'flex-start', fontFamily: fonts.bold, fontSize: 12, color: colors.accent, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  headline: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, color: '#FFFFFF' },
  sub: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.onAccentMuted },
  legal: { textAlign: 'center', fontFamily: fonts.body, fontSize: 12, color: '#CFE5DF' },
});
