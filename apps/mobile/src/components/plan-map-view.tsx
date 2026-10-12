import Feather from '@expo/vector-icons/Feather';
import { boundsAround, dayColor, IdeaList, type Idea, type ItineraryItem, type Trip } from '@tagalong/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { request } from '@/lib/api';
import { openDirections } from '@/lib/directions';
import { byPosition, shortDate } from '@/lib/plan';
import { useDayRoute, useRouteMode } from '@/lib/routes';
import { colors, fonts, radius, space } from '@/theme';
import { TripMap } from './trip-map';
import type { MapLine, MapPin } from './trip-map.types';
import { Body, Button } from './ui';

const NO_DAY_COLOR = '#8C867B';

interface Props {
  trip: Trip;
  items: ItineraryItem[];
  /** The trip's days, in order, so each gets its colour and number. */
  days: string[];
}

type Selected = { kind: 'item'; item: ItineraryItem } | { kind: 'idea'; idea: Idea };

/**
 * The plan on a map: every stop with a location, coloured by day, plus ideas
 * still being considered (outlined). Tap a pin for details and directions.
 */
export function PlanMapView({ trip, items, days }: Props) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [day, setDay] = useState<string | 'all'>('all');
  const [showIdeas, setShowIdeas] = useState(true);
  const [selected, setSelected] = useState<Selected | null>(null);

  useEffect(() => {
    request(`/trips/${trip.id}/ideas`, { schema: IdeaList })
      .then((data) => setIdeas(data.ideas))
      .catch(() => setIdeas([]));
  }, [trip.id]);

  const dayIndex = (date: string | null) => (date ? days.indexOf(date) : -1);

  // One day picked: draw its route in the day's colour, travelled the way chosen on the list.
  const filteredDate = day === 'all' ? null : day;
  const dayItems = useMemo(
    () => (filteredDate ? items.filter((i) => i.date === filteredDate).sort(byPosition) : []),
    [items, filteredDate],
  );
  const [mode] = useRouteMode(trip.id, filteredDate, dayItems);
  const route = useDayRoute(trip.id, filteredDate, mode, dayItems);
  const line = useMemo<MapLine | null>(
    () =>
      filteredDate && route?.geometry
        ? { coordinates: route.geometry.coordinates, color: dayColor(days.indexOf(filteredDate)) }
        : null,
    [filteredDate, route, days],
  );
  const located = items.filter((i) => i.latitude !== null && i.longitude !== null);
  const openIdeas = (ideas ?? []).filter((i) => i.latitude !== null && i.longitude !== null && !i.promotedItemId);

  const pins: MapPin[] = useMemo(() => {
    const itemPins = located
      .filter((i) => day === 'all' || i.date === day)
      .map((i): MapPin => {
        const n = dayIndex(i.date);
        return {
          id: `item:${i.id}`,
          latitude: i.latitude!,
          longitude: i.longitude!,
          color: n >= 0 ? dayColor(n) : NO_DAY_COLOR,
          label: n >= 0 ? String(n + 1) : '–',
          title: `${i.title}${n >= 0 ? `, day ${n + 1}` : ', no day yet'}`,
        };
      });
    const ideaPins =
      showIdeas && day === 'all'
        ? openIdeas.map(
            (i): MapPin => ({
              id: `idea:${i.id}`,
              latitude: i.latitude!,
              longitude: i.longitude!,
              color: colors.coral,
              label: '?',
              outlined: true,
              title: `Idea: ${i.title}`,
            }),
          )
        : [];
    return [...itemPins, ...ideaPins];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, openIdeas, day, showIdeas, days]);

  // Open on the pins, or the destination when there are none yet.
  const bounds =
    boundsAround(pins) ??
    trip.location?.bounds ??
    (trip.location ? boundsAround([trip.location], 0.1) : null);

  const daysWithPins = days.filter((d) => located.some((i) => i.date === d));

  const pick = (pin: MapPin) => {
    const [kind, id] = pin.id.split(':');
    if (kind === 'item') {
      const item = items.find((i) => i.id === id);
      if (item) setSelected({ kind: 'item', item });
    } else {
      const idea = ideas?.find((i) => i.id === id);
      if (idea) setSelected({ kind: 'idea', idea });
    }
  };

  // The map frames its pins once, when it opens, so wait until the ideas are in.
  if (ideas === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!bounds) {
    return (
      <View style={styles.center}>
        <Feather name="map" size={28} color={colors.accent} />
        <Body style={{ textAlign: 'center' }}>
          This trip isn’t on the map yet. Pick the destination from the suggestions in Edit trip, then add places
          from Explore.
        </Body>
        <Button label="Edit trip" variant="outline" onPress={() => router.push(`/trips/${trip.id}/edit`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filterBar}>
        <Pressable accessibilityRole="tab" aria-selected={day === 'all'} onPress={() => setDay('all')} style={[styles.chip, day === 'all' && styles.chipOn]}>
          <Text style={[styles.chipText, day === 'all' && { color: '#FFFFFF' }]}>All days</Text>
        </Pressable>
        {daysWithPins.map((d) => {
          const n = days.indexOf(d);
          const on = day === d;
          return (
            <Pressable key={d} accessibilityRole="tab" aria-selected={on} onPress={() => setDay(d)} style={[styles.chip, on && styles.chipOn]}>
              <View style={[styles.swatch, { backgroundColor: dayColor(n) }]} />
              <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                Day {n + 1}
              </Text>
            </Pressable>
          );
        })}
        {openIdeas.length > 0 ? (
          <Pressable
            accessibilityRole="switch"
            aria-checked={showIdeas}
            onPress={() => setShowIdeas((v) => !v)}
            style={[styles.chip, showIdeas && styles.chipIdeasOn]}
          >
            <View style={[styles.swatch, styles.ideaSwatch]} />
            <Text style={styles.chipText}>Ideas {showIdeas ? 'shown' : 'hidden'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={{ flex: 1 }}>
        <TripMap pins={pins} bounds={bounds} line={line} selectedId={selected ? `${selected.kind}:${selected.kind === 'item' ? selected.item.id : selected.idea.id}` : null} onPressPin={pick} />

        {pins.length === 0 ? (
          <View style={styles.overlayNote}>
            <Body style={{ fontSize: 13 }}>
              Nothing with a location yet. Places you add from Explore show up here, coloured by day.
            </Body>
            <Button label="Explore places" variant="outline" onPress={() => router.push(`/trips/${trip.id}/explore`)} style={{ minHeight: 40 }} />
          </View>
        ) : null}

        {selected ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {selected.kind === 'item' ? selected.item.title : selected.idea.title}
              </Text>
              <Text style={styles.cardMeta}>
                {selected.kind === 'item'
                  ? selected.item.date
                    ? `Day ${dayIndex(selected.item.date) + 1} · ${shortDate(selected.item.date)}${selected.item.startTime ? ` · ${selected.item.startTime}` : ''}`
                    : 'In the plan, no day yet'
                  : `Idea · ${selected.idea.ups} ${selected.idea.ups === 1 ? 'vote' : 'votes'} for`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Directions"
              onPress={() => {
                const target = selected.kind === 'item' ? selected.item : selected.idea;
                openDirections(target.title, trip.destination, target);
              }}
              style={styles.cardButton}
            >
              <Feather name="navigation" size={16} color={colors.accent} />
            </Pressable>
            <Button
              label="Open"
              variant="outline"
              onPress={() =>
                selected.kind === 'item'
                  ? router.push(`/trips/${trip.id}/items/${selected.item.id}`)
                  : router.push(`/trips/${trip.id}/ideas`)
              }
              style={{ minHeight: 40, paddingHorizontal: space.md }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSelected(null)} style={styles.cardButton}>
              <Feather name="x" size={16} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexGrow: 0 },
  filters: { gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipIdeasOn: { borderColor: colors.coral },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  ideaSwatch: { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: colors.coral },
  overlayNote: { position: 'absolute', left: space.xl, right: space.xl, top: space.md, gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  card: { position: 'absolute', left: space.md, right: space.md, bottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  cardMeta: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  cardButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
});
