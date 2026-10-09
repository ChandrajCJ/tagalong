import { regionAround, type Place } from '@tagalong/shared';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors, fonts } from '@/theme';
import type { PhotoMapProps } from './photo-map.types';

/**
 * The album on a map: one pin per place, showing a photo from it and how many
 * were taken there. Phones only; the browser gets photo-map.web.tsx instead.
 */
export function PhotoMap({ places, photosById, onOpenPlace }: PhotoMapProps) {
  // Framed once, around everything; panning afterwards is the person's own.
  const initialRegion = useMemo(() => regionAround(places) ?? undefined, [places]);

  return (
    <MapView style={StyleSheet.absoluteFill} initialRegion={initialRegion} showsPointsOfInterests={false}>
      {places.map((place) => {
        const cover = photosById.get(place.photoIds[0]!);
        return (
          <PlaceMarker
            key={place.id}
            place={place}
            thumbUrl={cover?.thumbUrl ?? null}
            coverId={cover?.id ?? place.id}
            onPress={() => onOpenPlace(place)}
          />
        );
      })}
    </MapView>
  );
}

function PlaceMarker({
  place,
  thumbUrl,
  coverId,
  onPress,
}: {
  place: Place;
  thumbUrl: string | null;
  coverId: string;
  onPress: () => void;
}) {
  /*
   * A custom marker is drawn once and then reused as a still picture. Until
   * its photo has loaded it must keep redrawing, or Android pins stay blank.
   * Once loaded, stop: redrawing every pin on every frame makes the map crawl.
   */
  const [loaded, setLoaded] = useState(!thumbUrl);
  const count = place.photoIds.length;

  return (
    <Marker
      coordinate={{ latitude: place.latitude, longitude: place.longitude }}
      onPress={onPress}
      tracksViewChanges={!loaded}
      accessibilityLabel={`${count} ${count === 1 ? 'photo' : 'photos'} here`}
    >
      <View style={styles.pin}>
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl, cacheKey: `${coverId}-thumb` }}
            style={styles.photo}
            contentFit="cover"
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        ) : (
          <View style={[styles.photo, { backgroundColor: colors.accentSoft }]} />
        )}
        {count > 1 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  pin: { width: 52, height: 52, borderRadius: 12, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  photo: { flex: 1, borderRadius: 9 },
  badge: { position: 'absolute', top: -8, right: -8, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: colors.coral, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, color: '#FFFFFF' },
});
