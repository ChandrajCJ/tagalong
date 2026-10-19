import Feather from '@expo/vector-icons/Feather';
import { CoverSuggestion, PhotoList, Trip, type Photo } from '@tagalong/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { ApiError, request } from '@/lib/api';
import { uploadPhoto } from '@/lib/photos';
import { colors, fonts, radius, space } from '@/theme';
import { ActionMenu } from './action-menu';
import { CoverImage } from './cover-image';
import { Body, Button } from './ui';

const SuggestionAnswer = z.object({ suggestion: CoverSuggestion.nullable() });

/** Picks a photo for a cover, cropped to the cover's 16:9 on the phone. */
export const pickCoverPhoto = async (): Promise<ImagePicker.ImagePickerAsset | string | null> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return 'Allow photo access to choose a cover photo.';
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [16, 9],
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return result.canceled ? null : (result.assets[0] ?? null);
};

/** Uploads a picked photo as the trip's cover and points the trip at it. */
export const uploadCover = async (tripId: string, asset: ImagePicker.ImagePickerAsset) => {
  const photo = await uploadPhoto(tripId, asset, 'cover');
  return request(`/trips/${tripId}/cover`, { method: 'PUT', body: { photoId: photo.id }, schema: Trip });
};

/**
 * The cover photo on Edit trip: upload one, pick one from the album, or use
 * the destination's photo from Wikipedia. Changes save straight away.
 */
export function CoverPhotoPicker({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [suggestion, setSuggestion] = useState<CoverSuggestion | null>(null);
  const [album, setAlbum] = useState<Photo[] | null>(null);
  const [choosingFromAlbum, setChoosingFromAlbum] = useState(false);

  useEffect(() => {
    void request(`/trips/${trip.id}/cover-suggestion`, { schema: SuggestionAnswer })
      .then((a) => setSuggestion(a.suggestion))
      .catch(() => undefined);
  }, [trip.id, trip.destination]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t change the cover. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    const picked = await pickCoverPhoto();
    if (typeof picked === 'string') return setError(picked);
    if (picked) await run(() => uploadCover(trip.id, picked));
  };

  const openAlbum = async () => {
    setChoosingFromAlbum(true);
    const list = await request(`/trips/${trip.id}/photos`, { schema: PhotoList }).catch(() => null);
    setAlbum(list?.photos.filter((p) => p.status === 'ready') ?? []);
  };

  const applySuggestion = () =>
    suggestion &&
    run(() =>
      request(`/trips/${trip.id}/cover`, {
        method: 'PUT',
        body: { wikipediaUrl: suggestion.url, credit: suggestion.credit },
      }),
    );

  const place = trip.destination.split(',')[0];

  return (
    <View style={{ gap: space.sm }}>
      <CoverImage
        color={trip.coverColor}
        uri={trip.coverUrl}
        cacheKey={`cover-${trip.id}`}
        credit={trip.coverCredit}
        style={styles.preview}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" style={{ flex: 1 }} /> : null}
      </CoverImage>
      <View style={styles.row}>
        <Button
          label={trip.coverUrl ? 'Change photo' : 'Choose a photo'}
          variant="outline"
          icon={<Feather name="image" size={16} color={colors.ink} />}
          onPress={() => setMenu(true)}
          disabled={busy}
          style={{ minHeight: 40 }}
        />
        {trip.coverPhotoId ? (
          <Button
            label="Remove photo"
            variant="ghost"
            onPress={() => void run(() => request(`/trips/${trip.id}/cover`, { method: 'DELETE' }))}
            disabled={busy}
            style={{ minHeight: 40 }}
          />
        ) : null}
      </View>
      <Body style={{ fontSize: 12 }}>
        {trip.coverUrl ? 'The colour shows behind the title and while the photo loads.' : 'Without a photo, the colour is the cover.'} Changes save straight away.
      </Body>
      {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}

      <ActionMenu
        visible={menu}
        title="Cover photo"
        onClose={() => setMenu(false)}
        actions={[
          { icon: 'upload', label: 'Upload a photo', hint: 'Cropped to fit the cover', onPress: () => void upload() },
          { icon: 'grid', label: 'From the trip album', onPress: () => void openAlbum() },
          ...(suggestion
            ? [
                {
                  icon: 'globe' as const,
                  label: `Photo of ${place} from Wikipedia`,
                  hint: suggestion.credit ?? 'Free to use, with credit shown on the cover',
                  onPress: () => void applySuggestion(),
                },
              ]
            : []),
        ]}
      />

      <Modal visible={choosingFromAlbum} animationType="slide" onRequestClose={() => setChoosingFromAlbum(false)}>
        <SafeAreaView style={styles.albumScreen}>
          <View style={styles.albumHeader}>
            <Text accessibilityRole="header" style={styles.albumTitle}>
              Pick a cover from the album
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setChoosingFromAlbum(false)} style={styles.close}>
              <Feather name="x" size={22} color={colors.ink} />
            </Pressable>
          </View>
          {!album ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} />
          ) : album.length === 0 ? (
            <Body style={{ padding: space.xl }}>The album is empty. Add photos in the Photos tab first.</Body>
          ) : (
            <FlatList
              data={album}
              numColumns={3}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ padding: 2 }}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use photo by ${item.uploaderName ?? 'someone'} as the cover`}
                  onPress={() => {
                    setChoosingFromAlbum(false);
                    void run(() => request(`/trips/${trip.id}/cover`, { method: 'PUT', body: { photoId: item.id } }));
                  }}
                  style={styles.cell}
                >
                  <Image
                    source={item.thumbUrl ? { uri: item.thumbUrl, cacheKey: `${item.id}-thumb` } : undefined}
                    contentFit="cover"
                    style={{ flex: 1 }}
                  />
                </Pressable>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 120, borderRadius: radius.lg },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  albumScreen: { flex: 1, backgroundColor: colors.bg },
  albumHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: space.md },
  albumTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 3, aspectRatio: 1, padding: 2 },
});
