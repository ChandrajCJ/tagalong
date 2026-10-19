import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme';

/** "0:12". */
export const clockDuration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** "▶ 0:12" in the corner of a video's tile. */
export function VideoBadge({ durationMs }: { durationMs: number | null }) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Feather name="play" size={10} color={colors.onPhoto} />
      {durationMs ? <Text style={styles.time}>{clockDuration(durationMs)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  time: { fontFamily: fonts.bold, fontSize: 10, color: colors.onPhoto },
});
