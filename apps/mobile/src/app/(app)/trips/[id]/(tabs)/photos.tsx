import Feather from '@expo/vector-icons/Feather';
import {
  clusterPlaces,
  FavouriteResult,
  hasRole,
  MAX_PHOTOS_PER_BATCH,
  Photo,
  PhotoFavourited,
  PhotoList,
  type Place,
} from '@tagalong/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoMap } from '@/components/photo-map';
import { PhotoViewer } from '@/components/photo-viewer';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { groupByDay, uploadBatch, type UploadProgress } from '@/lib/photos';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

const GAP = 3;

const chunkRows = (list: Photo[]) =>
  Array.from({ length: Math.ceil(list.length / 3) }, (_, i) => list.slice(i * 3, i * 3 + 3));

type Mode = 'days' | 'map' | 'favourites';
const MODES: { key: Mode; label: string }[] = [
  { key: 'days', label: 'By day' },
  { key: 'map', label: 'Map' },
  { key: 'favourites', label: 'Favourites' },
];

/** Everyone's photos in one album, by day (design: Album.dc.html). */
export default function PhotosTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const { width } = useWindowDimensions();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [lastFailed, setLastFailed] = useState<UploadProgress['failed']>([]);
  const [mode, setMode] = useState<Mode>('days');
  // What the viewer pages through: the whole album, one place, or the favourites.
  const [viewing, setViewing] = useState<{ photos: Photo[]; startId: string } | null>(null);
  const loadedAt = useRef(0);
  const expiresIn = useRef(600);

  const tripId = trip?.id;
  const canAdd = !!trip && hasRole(trip.myRole, 'editor');
  const size = Math.floor((Math.min(width, 700) - space.xl * 2 - GAP * 2) / 3);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const data = await request(`/trips/${tripId}/photos`, { schema: PhotoList });
      setPhotos(data.photos);
      expiresIn.current = data.expiresIn;
      loadedAt.current = Date.now();
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the photos');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The links are signed and expire. Coming back after a while, fetch fresh ones.
  useFocusEffect(
    useCallback(() => {
      const age = (Date.now() - loadedAt.current) / 1000;
      if (loadedAt.current && age > expiresIn.current * 0.8) void load();
    }, [load]),
  );

  const upsert = useCallback((photo: Photo) => {
    setPhotos((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((p) => p.id === photo.id);
      if (i === -1) return [...prev, photo];
      if (prev[i]!.version > photo.version) return prev;
      return prev.map((p) => (p.id === photo.id ? photo : p));
    });
  }, []);

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind === 'error' && m.code === 'removed') return router.replace('/trips');
    if (m.kind !== 'event') return;
    const { event } = m;
    if (event.type === 'photo.upserted') {
      // Events carry no links (they're signed per person), so fetch our own copy.
      void request(`/photos/${event.entityId}`, { schema: Photo })
        .then(upsert)
        .catch(() => {});
    } else if (event.type === 'photo.favourited') {
      const change = PhotoFavourited.safeParse(event.payload);
      if (change.success) applyFavourite(change.data);
    } else if (event.type === 'photo.deleted') {
      setPhotos((prev) => prev?.filter((p) => p.id !== event.entityId) ?? prev);
    } else if (event.type.startsWith('member.')) {
      void reloadTrip();
    }
  });

  /** Someone's heart: the count for everyone, and "mine" only if it was me. */
  const applyFavourite = useCallback(
    ({ photoId, userId, added, count }: PhotoFavourited) => {
      const update = (p: Photo) =>
        p.id !== photoId
          ? p
          : { ...p, favourites: count, favourited: userId === trip?.myUserId ? added : p.favourited };
      setPhotos((prev) => prev?.map(update) ?? prev);
      setViewing((v) => (v ? { ...v, photos: v.photos.map(update) } : v));
    },
    [trip?.myUserId],
  );

  const sections = useMemo(
    () => groupByDay((photos ?? []).filter((p) => p.status === 'ready'), trip?.startDate ?? null),
    [photos, trip?.startDate],
  );
  const flat = useMemo(() => sections.flatMap((s) => s.data.flat()), [sections]);
  const byId = useMemo(() => new Map(flat.map((p) => [p.id, p])), [flat]);
  const places = useMemo(
    () =>
      clusterPlaces(
        flat
          .filter((p) => p.latitude !== null && p.longitude !== null)
          .map((p) => ({ id: p.id, latitude: p.latitude!, longitude: p.longitude!, takenAt: p.takenAt })),
      ),
    [flat],
  );
  // The group's favourites: most-hearted first, then in the order they were taken.
  const favourites = useMemo(
    () => flat.filter((p) => p.favourites > 0).sort((a, b) => b.favourites - a.favourites),
    [flat],
  );

  const openPlace = (place: Place) => {
    const inPlace = place.photoIds.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
    if (inPlace.length > 0) setViewing({ photos: inPlace, startId: inPlace[0]!.id });
  };

  const favourite = async (photo: Photo) => {
    const on = !photo.favourited;
    const count = photo.favourites + (on ? 1 : -1);
    // Show it straight away; the server's answer (or a rollback) follows.
    applyFavourite({ photoId: photo.id, userId: trip!.myUserId, added: on, count });
    try {
      const saved = await request(`/photos/${photo.id}/favourite`, {
        method: on ? 'PUT' : 'DELETE',
        schema: FavouriteResult,
      });
      applyFavourite({ photoId: photo.id, userId: trip!.myUserId, added: on, count: saved.favourites });
    } catch {
      applyFavourite({ photoId: photo.id, userId: trip!.myUserId, added: !on, count: photo.favourites });
    }
  };

  const send = async (picked: { id?: string; asset: ImagePicker.ImagePickerAsset }[]) => {
    if (!tripId || picked.length === 0) return;
    setLastFailed([]);
    const result = await uploadBatch(tripId, picked, setProgress, upsert);
    setProgress(null);
    setLastFailed(result.failed);
  };

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to add photos to the album.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS_PER_BATCH,
      // When and where it was taken come from here; the upload drops it.
      exif: true,
      quality: 1,
      // Hand back a JPEG rather than HEIC where the phone can.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled) return;
    await send(result.assets.map((asset) => ({ asset })));
  };

  const canDelete = (photo: Photo) =>
    !!trip && (photo.uploadedBy === trip.myUserId || trip.myRole === 'owner');

  const remove = async (photo: Photo) => {
    setPhotos((prev) => prev?.filter((p) => p.id !== photo.id) ?? prev);
    await request(`/photos/${photo.id}`, { method: 'DELETE' }).catch(() => void load());
  };

  if (!trip) return null;

  const renderRow = ({ item: row }: { item: Photo[] }) => (
    <View style={styles.row}>
      {row.map((photo) => (
        <Pressable
          key={photo.id}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photo by ${photo.uploaderName ?? 'someone'}`}
          onPress={() => setViewing({ photos: mode === 'favourites' ? favourites : flat, startId: photo.id })}
          style={{ width: size, height: size }}
        >
          <Image
            // Cached by id: the signed link changes each time, the photo doesn't.
            source={
              photo.thumbUrl
                ? { uri: photo.thumbUrl, cacheKey: `${photo.id}-thumb` }
                : photo.url
                  ? { uri: photo.url, cacheKey: `${photo.id}-full` }
                  : undefined
            }
            contentFit="cover"
            transition={120}
            style={styles.tile}
          />
        </Pressable>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Title>Photos</Title>
          <Body style={{ fontSize: 13 }}>
            {flat.length === 0
              ? "Everyone's photos, in one place."
              : `${flat.length} ${flat.length === 1 ? 'photo' : 'photos'} from the group`}
          </Body>
        </View>
        {canAdd && flat.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            disabled={!!progress}
            onPress={pick}
            style={[styles.addButton, progress && { opacity: 0.5 }]}
          >
            <Feather name="plus" size={18} color="#FFFFFF" />
            <Text style={styles.addText}>Add</Text>
          </Pressable>
        ) : null}
      </View>

      {flat.length > 0 ? (
        <View style={styles.modes} accessibilityRole="tablist">
          {MODES.map((m) => {
            const on = mode === m.key;
            return (
              <Pressable
                key={m.key}
                accessibilityRole="tab"
                aria-selected={on}
                onPress={() => setMode(m.key)}
                style={[styles.mode, on && styles.modeOn]}
              >
                <Text style={[styles.modeText, on && { color: '#FFFFFF' }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {progress ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.accent} />
          <Body style={{ flex: 1, color: colors.ink }}>
            Uploading {Math.min(progress.done + progress.failed.length + 1, progress.total)} of{' '}
            {progress.total}…
          </Body>
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.round(((progress.done + progress.failed.length) / progress.total) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      {lastFailed.length > 0 && !progress ? (
        <View style={[styles.banner, styles.bannerError]} accessibilityLiveRegion="polite">
          <Feather name="alert-circle" size={18} color={colors.coralInk} />
          <Body style={{ flex: 1, color: colors.coralInk }}>
            {lastFailed.length} {lastFailed.length === 1 ? "photo didn't" : "photos didn't"} upload.
          </Body>
          <Button
            label="Retry"
            variant="ghost"
            onPress={() => void send(lastFailed)}
            style={{ minHeight: 36, paddingHorizontal: space.sm }}
          />
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Body style={{ textAlign: 'center' }}>{error}</Body>
          <Button label="Try again" variant="outline" onPress={load} />
        </View>
      ) : !photos ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : flat.length === 0 && !progress ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Feather name="image" size={28} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>No photos yet</Text>
          <Body style={{ textAlign: 'center' }}>
            Add yours and everyone&apos;s land here, sorted by day. Nobody has to send them round.
          </Body>
          {canAdd ? <Button label="Add photos" onPress={pick} /> : null}
        </View>
      ) : mode === 'map' ? (
        places.length === 0 ? (
          <View style={styles.center}>
            <Feather name="map" size={28} color={colors.accent} />
            <Body style={{ textAlign: 'center' }}>
              No photos have a location yet. Phones add one when location is on for the camera.
            </Body>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <PhotoMap places={places} photosById={byId} onOpenPlace={openPlace} />
          </View>
        )
      ) : mode === 'favourites' ? (
        favourites.length === 0 ? (
          <View style={styles.center}>
            <Feather name="heart" size={28} color={colors.accent} />
            <Body style={{ textAlign: 'center' }}>
              No favourites yet. Open a photo and tap the heart; the group&apos;s best rise here.
            </Body>
          </View>
        ) : (
          <SectionList
            sections={[{ key: 'favourites', title: 'Group favourites', data: chunkRows(favourites) }]}
            keyExtractor={(row) => row.map((p) => p.id).join()}
            renderItem={renderRow}
            contentContainerStyle={[styles.list, { paddingTop: space.md }]}
          />
        )
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.map((p) => p.id).join()}
          renderItem={renderRow}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {section.title}
              </Text>
              <Text style={styles.sectionMeta}>
                {[section.subtitle, `${section.count} ${section.count === 1 ? 'photo' : 'photos'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.list}
        />
      )}

      <PhotoViewer
        photos={viewing?.photos ?? []}
        startId={viewing?.startId ?? null}
        canDelete={canDelete}
        onDelete={async (photo) => {
          await remove(photo);
          setViewing((v) => (v ? { ...v, photos: v.photos.filter((p) => p.id !== photo.id) } : v));
        }}
        onFavourite={(photo) => void favourite(photo)}
        onClose={() => setViewing(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.accent },
  addText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  banner: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginHorizontal: space.xl, marginBottom: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  bannerError: { backgroundColor: colors.coralSoft },
  bar: { width: '100%', height: 4, borderRadius: 2, backgroundColor: 'rgba(14,107,92,0.2)', overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
  list: { paddingHorizontal: space.xl, paddingBottom: 96 },
  modes: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xl, paddingBottom: space.sm },
  mode: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  modeOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  modeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingTop: space.lg, paddingBottom: space.sm, backgroundColor: colors.bg },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  sectionMeta: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  tile: { flex: 1, borderRadius: 4, backgroundColor: colors.line },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
});
