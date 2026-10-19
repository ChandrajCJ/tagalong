import Feather from '@expo/vector-icons/Feather';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/theme';

/**
 * Over-the-air updates (EAS Update): the app checks for a new version each
 * time it opens and downloads it in the background. Once it's ready, this
 * offers to restart into it now; otherwise it's used from the next launch.
 * Nothing shows on the web, in Expo Go or in development, where updates are off.
 */
export function UpdateBanner() {
  if (!Updates.isEnabled) return null;
  return <ReadyBanner />;
}

function ReadyBanner() {
  const { isUpdatePending } = Updates.useUpdates();
  const [later, setLater] = useState(false);
  if (!isUpdatePending || later) return null;

  return (
    <SafeAreaView edges={['bottom']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert">
        <Feather name="download" size={18} color={colors.onFill} />
        <Text style={styles.text}>A new version of Tagalong is ready.</Text>
        <Pressable accessibilityRole="button" onPress={() => setLater(true)} style={styles.button}>
          <Text style={styles.later}>Later</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void Updates.reloadAsync()} style={[styles.button, styles.restart]}>
          <Text style={styles.restartText}>Restart</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, paddingBottom: space.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    marginBottom: 64,
  },
  text: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.onFill },
  button: { minHeight: 40, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  later: { fontFamily: fonts.bold, fontSize: 14, color: colors.onFillMuted },
  restart: { backgroundColor: colors.surface },
  restartText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
});
