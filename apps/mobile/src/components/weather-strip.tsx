import Feather from '@expo/vector-icons/Feather';
import { TripWeather, tripWeather, weatherInfo, type Trip } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { request } from '@/lib/api';
import { weekdayOf } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';

/**
 * The weather for the trip's days: a forecast for the coming two weeks, or
 * last year's weather on the same dates for a trip further out. Hidden when
 * the trip has no real location or is over.
 *
 * The phone asks Open-Meteo itself: it limits requests per address, and a free
 * server's address is shared with strangers who use the allowance up. The
 * API's copy is the fallback.
 */
export function WeatherStrip({ trip }: { trip: Trip }) {
  const [weather, setWeather] = useState<TripWeather | null>(null);
  const latitude = trip.location?.latitude ?? null;
  const longitude = trip.location?.longitude ?? null;
  // Each day's weather is at that day's place.
  const places = trip.places.map((p) => ({
    destination: p.destination,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  const placesKey = JSON.stringify(places);

  useEffect(() => {
    let live = true;
    const today = new Date().toISOString().slice(0, 10);
    tripWeather(fetch, { latitude, longitude, startDate: trip.startDate, endDate: trip.endDate }, today, undefined, places)
      .catch(() => request(`/trips/${trip.id}/weather`, { schema: TripWeather }))
      .then((w) => live && setWeather(w))
      .catch(() => live && setWeather(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id, latitude, longitude, trip.startDate, trip.endDate, placesKey]);

  if (!weather || weather.kind === 'none' || weather.days.length === 0) return null;
  const typical = weather.kind === 'typical';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{typical ? 'Typical weather' : 'Weather'}</Text>
        <Text style={styles.note}>{typical ? 'Last year on these dates' : 'Forecast'}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {weather.days.map((d, i) => {
          const info = weatherInfo(d.code);
          // The city over its first day, when the trip moves on.
          const newPlace = d.place && d.place !== weather.days[i - 1]?.place ? d.place : null;
          return (
            <View
              key={d.date}
              style={styles.day}
              accessible
              accessibilityLabel={`${weekdayOf(d.date)} ${d.date.slice(8)}${d.place ? ` in ${d.place}` : ''}: ${info.label}, ${d.maxC} to ${d.minC} degrees${d.rainChance != null ? `, ${d.rainChance}% chance of rain` : ''}`}
            >
              {weather.days.some((w) => w.place) ? (
                <Text style={styles.place} numberOfLines={1}>
                  {newPlace ?? ' '}
                </Text>
              ) : null}
              <Text style={styles.weekday}>
                {weekdayOf(d.date)} {Number(d.date.slice(8))}
              </Text>
              <Feather name={info.icon} size={20} color={colors.accent} />
              <Text style={styles.max}>{d.maxC}°</Text>
              <Text style={styles.min}>{d.minC}°</Text>
              {d.rainChance != null && d.rainChance >= 30 ? <Text style={styles.rain}>{d.rainChance}%</Text> : null}
              {d.rainMm != null && d.rainMm >= 1 ? <Text style={styles.rain}>{Math.round(d.rainMm)} mm</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: space.lg },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  note: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  days: { paddingHorizontal: space.lg, gap: space.md },
  day: { alignItems: 'center', gap: 2, minWidth: 48 },
  weekday: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  place: { maxWidth: 72, fontFamily: fonts.bold, fontSize: 11, color: colors.accent },
  max: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  min: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  rain: { fontFamily: fonts.bold, fontSize: 11, color: colors.rain },
});
