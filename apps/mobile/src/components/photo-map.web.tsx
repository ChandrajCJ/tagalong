import Feather from '@expo/vector-icons/Feather';
import { mapsLink } from '@tagalong/shared';
import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dateSpan } from '@/lib/photos';
import { colors, fonts, radius, space } from '@/theme';
import { Body } from './ui';
import type { PhotoMapProps } from './photo-map.types';

/**
 * The browser's stand-in for the map: the map component only runs on phones.
 * The same places, as a list, each with a link to open the spot in a maps app.
 * Metro picks this file over photo-map.tsx when bundling for the web.
 */
export function PhotoMap({ places, photosById, onOpenPlace }: PhotoMapProps) {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Body style={{ fontSize: 13 }}>
        The map shows on phones. Here are the same places as a list.
      </Body>
      {places.map((place) => {
        const count = place.photoIds.length;
        const covers = place.photoIds.slice(0, 4).map((id) => photosById.get(id)).filter(Boolean);
        return (
          // The card opens the photos and the link opens a maps app: siblings,
          // because a button can't contain another one.
          <View key={place.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${count} ${count === 1 ? 'photo' : 'photos'}, ${dateSpan(place.from, place.to)}`}
              onPress={() => onOpenPlace(place)}
            >
              <View style={styles.strip}>
                {covers.map((photo) => (
                  <Image
                    key={photo!.id}
                    source={photo!.thumbUrl ? { uri: photo!.thumbUrl } : undefined}
                    style={styles.thumb}
                    contentFit="cover"
                  />
                ))}
              </View>
              <View style={styles.meta}>
                <Text style={styles.title}>
                  {count} {count === 1 ? 'photo' : 'photos'}
                </Text>
                <Body style={{ fontSize: 12 }}>{dateSpan(place.from, place.to)}</Body>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open this place in maps"
              onPress={() => void Linking.openURL(mapsLink(place.latitude, place.longitude))}
              style={styles.link}
            >
              <Feather name="map-pin" size={14} color={colors.accent} />
              <Text style={styles.linkText}>Open in maps</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl, gap: space.md, paddingBottom: 96 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  strip: { flexDirection: 'row', height: 88, gap: 2 },
  thumb: { flex: 1, backgroundColor: colors.line },
  meta: { gap: 2, paddingHorizontal: space.md, paddingTop: space.md },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space.md },
  linkText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
});
