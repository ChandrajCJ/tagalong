import Feather from '@expo/vector-icons/Feather';
import { boundsAround, dayColor, formatMoney, weatherInfo, type DayHeader, type Photo, type WeatherDay } from '@tagalong/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spokenDate, todayIso } from '@/lib/dates';
import { dayWeather } from '@/lib/journal';
import { formatDistance, formatDuration, MODE_META, useDayRoute, useRouteMode } from '@/lib/routes';
import { colors, fonts, radius, space } from '@/theme';
import { TripMap } from './trip-map';
import type { MapLine, MapPin } from './trip-map.types';
import { Body, Label } from './ui';

interface Props {
  tripId: string;
  header: DayHeader;
  onOpenPhoto: (photo: Photo) => void;
}

/** "10:40" from an instant, on this phone's clock. */
const clockOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The top of a journal day, filled in with no typing: where you were, the
 * weather, the day's stops on a map, the day in numbers and its highlights.
 */
export function JournalDayHeader({ tripId, header: h, onOpenPhoto }: Props) {
  const [weather, setWeather] = useState<WeatherDay | null>(null);
  const today = todayIso();
  const centre = h.centre;

  useEffect(() => {
    if (!centre) return;
    let live = true;
    dayWeather(centre, h.date, today)
      .then((w) => live && setWeather(w))
      .catch(() => live && setWeather(null));
    return () => {
      live = false;
    };
  }, [centre?.latitude, centre?.longitude, h.date, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mode] = useRouteMode(tripId, h.date, h.stops);
  const route = useDayRoute(tripId, h.date, mode, h.stops);
  const colour = dayColor((h.dayNumber ?? 1) - 1);
  const pins: MapPin[] = useMemo(
    () =>
      h.stops
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .map((s, i) => ({
        id: s.id,
        latitude: s.latitude!,
        longitude: s.longitude!,
        color: colour,
        label: String(i + 1),
        title: s.title,
      })),
    [h.stops, colour],
  );
  const bounds = boundsAround(pins);
  const line: MapLine | null = route?.geometry ? { coordinates: route.geometry.coordinates, color: colour } : null;
  const info = weather ? weatherInfo(weather.code) : null;
  const past = h.date < today;

  const numbers = [
    h.photoCount > 0 ? `${h.photoCount} ${h.photoCount === 1 ? 'photo' : 'photos'}` : null,
    h.videoCount > 0 ? `${h.videoCount} ${h.videoCount === 1 ? 'video' : 'videos'}` : null,
    h.messageCount > 0 ? `${h.messageCount} ${h.messageCount === 1 ? 'message' : 'messages'}` : null,
    h.spentMinor > 0
      ? `${formatMoney(h.spentMinor, h.currency)} spent (${formatMoney(h.spentPerPersonMinor, h.currency)} each)`
      : null,
  ].filter(Boolean);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={styles.title}>
          {[h.dayNumber ? `Day ${h.dayNumber}` : null, h.city].filter(Boolean).join(' · ') || spokenDate(h.date)}
        </Text>
        <Body style={{ fontSize: 13 }}>{spokenDate(h.date)}</Body>
      </View>

      {info && weather ? (
        <View style={styles.weather}>
          <Feather name={info.icon} size={18} color={colors.accent} />
          <Text style={styles.weatherText}>
            {weather.maxC}° / {weather.minC}° · {info.label}
            {past ? '' : weather.rainChance != null && weather.rainChance >= 30 ? ` · ${weather.rainChance}% chance of rain` : ''}
          </Text>
          <Body style={{ fontSize: 12 }}>{past ? 'as it was' : 'forecast'}</Body>
        </View>
      ) : null}

      {h.stops.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>Where you went</Label>
          {bounds ? (
            <View style={styles.map}>
              <TripMap pins={pins} bounds={bounds} onPressPin={(pin) => router.push(`/trips/${tripId}/items/${pin.id}`)} line={line} />
            </View>
          ) : null}
          {h.stops.map((s, i) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              onPress={() => router.push(`/trips/${tripId}/items/${s.id}`)}
              style={styles.stop}
            >
              <Text style={[styles.stopNumber, { color: colour }]}>{i + 1}</Text>
              <Text style={styles.stopTitle} numberOfLines={1}>
                {s.title}
              </Text>
              {s.startTime ? <Body style={{ fontSize: 13 }}>{s.startTime}</Body> : null}
            </Pressable>
          ))}
          {route && route.totalDistanceM > 0 ? (
            <Body style={{ fontSize: 13 }}>
              {route.estimated ? 'About ' : ''}
              {formatDistance(route.totalDistanceM)} · {formatDuration(route.totalDurationS)} {MODE_META[route.mode].doing}
            </Body>
          ) : h.distanceM ? (
            <Body style={{ fontSize: 13 }}>At least {formatDistance(h.distanceM)} between the stops</Body>
          ) : null}
        </View>
      ) : null}

      {numbers.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>The day in numbers</Label>
          <Body>{numbers.join(' · ')}</Body>
        </View>
      ) : null}

      {h.topPhotos.length > 0 || h.topIdea || h.busiest ? (
        <View style={{ gap: space.sm }}>
          <Label>Highlights</Label>
          {h.topPhotos.length > 0 ? (
            <View style={styles.photos}>
              {h.topPhotos.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Photo by ${p.uploaderName ?? 'someone'}${p.favourites ? `, ${p.favourites} hearts` : ''}`}
                  onPress={() => onOpenPhoto(p)}
                  style={styles.photo}
                >
                  <Image source={p.thumbUrl ? { uri: p.thumbUrl, cacheKey: `${p.id}-thumb` } : undefined} contentFit="cover" style={{ flex: 1 }} />
                </Pressable>
              ))}
            </View>
          ) : null}
          {h.topIdea ? (
            <View style={styles.highlight}>
              <Feather name="zap" size={14} color={colors.accent} />
              <Body style={{ flex: 1 }}>
                Most-voted idea: <Text style={styles.strong}>{h.topIdea.title}</Text> ({h.topIdea.votes}{' '}
                {h.topIdea.votes === 1 ? 'vote' : 'votes'})
              </Body>
            </View>
          ) : null}
          {h.busiest ? (
            <Pressable accessibilityRole="link" onPress={() => router.push(`/trips/${tripId}/chat`)} style={styles.highlight}>
              <Feather name="message-square" size={14} color={colors.accent} />
              <Body style={{ flex: 1 }}>
                Busiest chat: <Text style={styles.strong}>{h.busiest.count} messages</Text> from {clockOf(h.busiest.from)}
              </Body>
              <Feather name="chevron-right" size={16} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  weather: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  weatherText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.accentInk },
  map: { height: 180, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  stop: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  stopNumber: { width: 18, fontFamily: fonts.bold, fontSize: 14, textAlign: 'center' },
  stopTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  photos: { flexDirection: 'row', gap: space.sm },
  photo: { flex: 1, aspectRatio: 1, maxWidth: 120, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.accentWash },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  strong: { fontFamily: fonts.bold, color: colors.ink },
});
