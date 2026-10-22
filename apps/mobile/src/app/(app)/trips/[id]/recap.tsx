import Feather from '@expo/vector-icons/Feather';
import { boundsAround, dayColor, formatMoney, newId, Trip, TripRecap, weatherInfo, type Photo, type WeatherDay } from '@tagalong/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoverImage } from '@/components/cover-image';
import { PhotoViewer } from '@/components/photo-viewer';
import { TripMap } from '@/components/trip-map';
import type { MapPin } from '@/components/trip-map.types';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { spokenDate, todayIso } from '@/lib/dates';
import { formatDateRange } from '@/lib/format';
import { tripPastWeather } from '@/lib/journal';
import { canSaveImage, shareRecap } from '@/lib/recap-image';
import { formatDistance } from '@/lib/routes';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

/** The story of a finished trip: the numbers, each day on the map, and a way to plan the next one. */
export default function RecapScreen() {
  const { trip } = useTrip();
  const [recap, setRecap] = useState<TripRecap | null>(null);
  const [error, setError] = useState<string>();
  const [weather, setWeather] = useState<Map<string, WeatherDay>>(new Map());
  const [current, setCurrent] = useState(0);
  const [viewing, setViewing] = useState<{ photos: Photo[]; startId: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const offsets = useRef<number[]>([]);
  const tripId = trip?.id;

  useEffect(() => {
    if (!tripId) return;
    request(`/trips/${tripId}/recap`, { schema: TripRecap })
      .then(setRecap)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Couldn’t load the recap'));
  }, [tripId]);

  useEffect(() => {
    if (trip) void tripPastWeather(trip, todayIso()).then(setWeather);
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const photoOf = useMemo(() => new Map((recap?.photos ?? []).map((p) => [p.id, p])), [recap]);
  const nameOf = (userId: string) => recap?.members.find((m) => m.userId === userId)?.displayName ?? 'Someone';
  const photosFor = (ids: string[]) => ids.flatMap((id) => (photoOf.has(id) ? [photoOf.get(id)!] : []));

  // The map follows the day being read: the one whose section is nearest the top.
  const day = recap?.days[current];
  const allStops = useMemo(() => (recap?.days ?? []).flatMap((d) => d.route), [recap]);
  const pins: MapPin[] = useMemo(
    () =>
      (day?.route ?? []).map((s, i) => ({
        id: `${day!.date}-${i}`,
        latitude: s.latitude,
        longitude: s.longitude,
        color: dayColor(current),
        label: String(i + 1),
        title: s.title,
      })),
    [day, current],
  );
  const bounds = boundsAround(pins.length > 0 ? pins : allStops);

  if (!trip) return null;
  const money = (minor: number) => formatMoney(minor, recap?.currency ?? trip.baseCurrency);

  const onScroll = (y: number) => {
    let index = 0;
    offsets.current.forEach((top, i) => {
      if (top <= y + 260) index = i;
    });
    if (index !== current) setCurrent(index);
  };

  const planNext = async () => {
    setStarting(true);
    try {
      const next = await request('/trips', {
        method: 'POST',
        body: { id: newId(), name: `${trip.name}, again`, destination: trip.destination, baseCurrency: trip.baseCurrency, copyMembersFrom: trip.id },
        schema: Trip,
      });
      router.replace(`/trips/${next.id}/edit`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t start the next trip');
      setStarting(false);
    }
  };

  if (error && !recap) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Body>{error}</Body>
        <Button label="Back" variant="outline" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!recap) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const s = recap.stats;
  const facts = [
    `${s.days} ${s.days === 1 ? 'day' : 'days'}${s.places > 1 ? ` · ${s.places} places` : ''}`,
    s.distanceM > 0 ? `About ${formatDistance(s.distanceM)} travelled` : null,
    s.photos + s.videos > 0
      ? `${s.photos} ${s.photos === 1 ? 'photo' : 'photos'}${s.videos ? ` and ${s.videos} ${s.videos === 1 ? 'video' : 'videos'}` : ''}`
      : null,
    s.messages > 0 ? `${s.messages} ${s.messages === 1 ? 'message' : 'messages'}${s.topEmoji ? ` · most used ${s.topEmoji}` : ''}` : null,
    s.biggestExpense ? `Biggest shared cost: ${s.biggestExpense.description}, ${money(s.biggestExpense.amountMinor)}` : null,
  ].filter((f): f is string => !!f);
  const dates = formatDateRange(recap.startDate, recap.endDate);
  // White over a photo; the cover colours' own ink without one.
  const ink = { color: recap.coverUrl ? colors.onPhoto : colors.onCover };

  return (
    <View style={styles.screen}>
      <ScrollView
        stickyHeaderIndices={recap.days.length > 0 && bounds ? [3] : []}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* 0: the cover */}
        <CoverImage color={recap.coverColor} uri={recap.coverUrl} cacheKey={`cover-${recap.tripId}`} style={styles.cover}>
          <SafeAreaView edges={['top']} style={styles.coverInner}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
              <Feather name="chevron-left" size={24} color={ink.color} />
            </Pressable>
            <View style={{ gap: space.sm }}>
              <Text style={[styles.kicker, ink]}>{recap.final ? 'Trip recap' : 'Recap so far'}</Text>
              <Text accessibilityRole="header" style={[styles.title, ink, !recap.coverUrl && { textShadowRadius: 0 }]}>
                {recap.name}
              </Text>
              <Text style={[styles.coverMeta, ink]}>{dates}</Text>
              <View style={{ flexDirection: 'row' }}>
                {recap.members.slice(0, 8).map((m, i) => (
                  <View key={m.userId} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar name={m.displayName} userId={m.userId} color={avatarColor(i)} size={30} />
                  </View>
                ))}
              </View>
            </View>
          </SafeAreaView>
        </CoverImage>

        {/* 1: the numbers */}
        <View style={styles.section}>
          <View style={[styles.stats, { backgroundColor: recap.coverColor }]}>
            {facts.map((f) => (
              <Text key={f} style={styles.fact}>
                {f}
              </Text>
            ))}
          </View>
          {photosFor(s.topPhotoIds).length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>Most loved photos</Label>
              <PhotoRow photos={photosFor(s.topPhotoIds)} onOpen={(p, all) => setViewing({ photos: all, startId: p.id })} />
            </View>
          ) : null}
          {s.spend.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>Each person’s share of the spending</Label>
              {s.spend.map((p) => (
                <View key={p.userId} style={styles.spend}>
                  <Body style={{ flex: 1, color: colors.ink }}>{nameOf(p.userId)}</Body>
                  <Text style={styles.spendAmount}>{money(p.shareMinor)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Button
            label={canSaveImage ? 'Save as image' : 'Share the numbers'}
            variant="outline"
            icon={<Feather name={canSaveImage ? 'download' : 'share'} size={16} color={colors.ink} />}
            onPress={() => void shareRecap({ title: recap.name, subtitle: dates, lines: facts, colour: recap.coverColor })}
          />
        </View>

        {/* 2: the heading for the days */}
        <View style={[styles.section, { paddingBottom: 0 }]}>{recap.days.length > 0 ? <Label>Day by day</Label> : null}</View>

        {/* 3: the map, which stays at the top while the days scroll under it */}
        {recap.days.length > 0 && bounds ? (
          <View style={styles.mapBand}>
            <View style={styles.map}>
              <TripMap key={`${current}-${pins.length}`} pins={pins} bounds={bounds} onPressPin={() => {}} line={pins.length > 1 ? { coordinates: pins.map((p) => [p.longitude, p.latitude]), color: dayColor(current) } : null} />
            </View>
            <Text style={styles.mapCaption}>
              Day {day?.dayNumber}
              {day?.city ? ` · ${day.city}` : ''}
            </Text>
          </View>
        ) : (
          <View />
        )}

        {recap.days.map((d, i) => {
          const w = weather.get(d.date);
          const info = w ? weatherInfo(w.code) : null;
          const photos = photosFor(d.topPhotoIds);
          return (
            <View
              key={d.date}
              onLayout={(e: LayoutChangeEvent) => {
                offsets.current[i] = e.nativeEvent.layout.y;
              }}
              style={styles.day}
            >
              <Text style={[styles.dayTitle, { color: dayColor(i) }]}>
                Day {d.dayNumber}
                {d.city ? ` · ${d.city}` : ''}
              </Text>
              <Body style={{ fontSize: 13 }}>
                {spokenDate(d.date)}
                {w && info ? ` · ${w.maxC}°/${w.minC}° ${info.label.toLowerCase()}` : ''}
              </Body>
              {photos.length > 0 ? <PhotoRow photos={photos} onOpen={(p, all) => setViewing({ photos: all, startId: p.id })} /> : null}
              {d.snippets.map((sn, k) => (
                <View key={k} style={styles.snippet}>
                  <Body style={{ color: colors.ink }}>
                    {sn.mood ? `${sn.mood} ` : ''}“{sn.body}”
                  </Body>
                  <Body style={{ fontSize: 12 }}>{nameOf(sn.authorId)}</Body>
                </View>
              ))}
              <Pressable accessibilityRole="link" onPress={() => router.push(`/trips/${recap.tripId}/journal/${d.date}`)} style={styles.openDay}>
                <Text style={styles.openDayText}>Open this day in the journal</Text>
              </Pressable>
            </View>
          );
        })}

        {/* The ending */}
        <View style={styles.section}>
          {photosFor(recap.groupPhotoIds).length > 0 ? (
            <View style={styles.grid}>
              {photosFor(recap.groupPhotoIds).map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Photo by ${p.uploaderName ?? 'someone'}`}
                  onPress={() => setViewing({ photos: photosFor(recap.groupPhotoIds), startId: p.id })}
                  style={styles.gridCell}
                >
                  <Image source={p.thumbUrl ? { uri: p.thumbUrl, cacheKey: `${p.id}-thumb` } : undefined} contentFit="cover" style={{ flex: 1 }} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.ending}>That was {recap.name}.</Text>
          <Button label="Plan the next one" onPress={() => void planNext()} loading={starting} />
          <Body style={{ fontSize: 12, textAlign: 'center' }}>Starts a new trip with the same people. Only people on this trip can see this recap.</Body>
          {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
        </View>
      </ScrollView>

      {viewing ? (
        <PhotoViewer photos={viewing.photos} startId={viewing.startId} canDelete={() => false} onDelete={async () => {}} onClose={() => setViewing(null)} />
      ) : null}
    </View>
  );
}

function PhotoRow({ photos, onOpen }: { photos: Photo[]; onOpen: (photo: Photo, all: Photo[]) => void }) {
  return (
    <View style={styles.photoRow}>
      {photos.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photo by ${p.uploaderName ?? 'someone'}${p.favourites ? `, ${p.favourites} hearts` : ''}`}
          onPress={() => onOpen(p, photos)}
          style={styles.photo}
        >
          <Image source={p.thumbUrl ? { uri: p.thumbUrl, cacheKey: `${p.id}-thumb` } : undefined} contentFit="cover" style={{ flex: 1 }} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  cover: { height: 320 },
  coverInner: { flex: 1, padding: space.xl, justifyContent: 'space-between' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -space.sm },
  kicker: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: colors.onPhoto },
  title: { fontFamily: fonts.display, fontSize: 34, color: colors.onPhoto, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  coverMeta: { fontFamily: fonts.medium, fontSize: 15, color: colors.onPhoto },
  section: { padding: space.xl, gap: space.lg },
  stats: { borderRadius: radius.xl, padding: space.xl, gap: space.sm },
  fact: { fontFamily: fonts.bold, fontSize: 17, color: colors.onCover },
  spend: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  spendAmount: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  mapBand: { backgroundColor: colors.bg, paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.xs },
  map: { height: 200, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  mapCaption: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  day: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dayTitle: { fontFamily: fonts.display, fontSize: 20 },
  snippet: { gap: 2, paddingLeft: space.md, borderLeftWidth: 3, borderLeftColor: colors.line },
  openDay: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' },
  openDayText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  photoRow: { flexDirection: 'row', gap: space.sm },
  photo: { flex: 1, aspectRatio: 1, maxWidth: 140, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.accentWash },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  gridCell: { width: '32%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.accentWash },
  ending: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, textAlign: 'center' },
});
