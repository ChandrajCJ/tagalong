import { Image } from 'expo-image';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { fonts } from '@/theme';

/** Darkens the bottom of a photo so white text on it stays readable. */
const SCRIM = 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.6) 100%)';
const scrimStyle = (Platform.OS === 'web'
  ? { backgroundImage: SCRIM }
  : { experimental_backgroundImage: SCRIM }) as unknown as ViewStyle;

interface Props {
  /** The trip's colour: shown alone without a photo, and behind it while it loads. */
  color: string;
  uri: string | null;
  /** Kept by id, since the signed link changes on every fetch. */
  cacheKey?: string;
  credit?: string | null;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/** A trip's cover: its photo with a dark gradient for the title, or just its colour. */
export function CoverImage({ color, uri, cacheKey, credit, style, children }: Props) {
  return (
    <View style={[{ backgroundColor: color, overflow: 'hidden' }, style]}>
      {uri ? (
        <>
          <Image
            source={{ uri, cacheKey }}
            contentFit="cover"
            transition={200}
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
          <View style={[StyleSheet.absoluteFill, scrimStyle]} pointerEvents="none" />
          {credit ? (
            <Text style={styles.credit} numberOfLines={1}>
              {credit}
            </Text>
          ) : null}
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  credit: { position: 'absolute', right: 8, bottom: 4, maxWidth: '70%', fontFamily: fonts.body, fontSize: 9, color: 'rgba(255,255,255,0.8)' },
});
