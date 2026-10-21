import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onServerState } from '@/lib/api';
import { colors, fonts, radius, space } from '@/theme';

/**
 * Tagalong's free server sleeps when nobody has used it for a while and takes
 * up to a minute to wake. While requests are waiting for it (lib/api.ts keeps
 * retrying), say so instead of looking broken.
 */
export function ServerWakingBanner() {
  const [waking, setWaking] = useState(false);
  useEffect(() => onServerState((state) => setWaking(state === 'waking')), []);
  if (!waking) return null;

  return (
    <SafeAreaView edges={['top']} style={styles.wrap} pointerEvents="none">
      <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={colors.accentInk} />
        <Text style={styles.text}>Waking up the server. This can take up to a minute…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  text: { fontFamily: fonts.medium, fontSize: 13, color: colors.accentInk },
});
