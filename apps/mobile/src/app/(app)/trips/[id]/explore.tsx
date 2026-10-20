import Feather from '@expo/vector-icons/Feather';
import {
  cityOf,
  hasRole,
  Idea,
  IdeaList,
  newId,
  RECOMMENDATION_CATEGORIES,
  RecommendationList,
  type Recommendation,
  type RecommendationCategory,
} from '@tagalong/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { openDirections } from '@/lib/directions';
import { VIEWER_NOTE } from '@/lib/roles';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

const CATEGORY_META: Record<RecommendationCategory, { label: string; icon: IconName }> = {
  sights: { label: 'Top sights', icon: 'star' },
  food: { label: 'Food & drink', icon: 'coffee' },
  nature: { label: 'Nature & beaches', icon: 'sun' },
  culture: { label: 'Museums & culture', icon: 'book-open' },
  nightlife: { label: 'Nightlife', icon: 'moon' },
  shopping: { label: 'Shopping', icon: 'shopping-bag' },
};

/** Places worth going to near the destination, ready to drop into Ideas. */
export default function ExploreScreen() {
  const { trip } = useTrip();
  const [category, setCategory] = useState<RecommendationCategory>('sights');
  // On a trip to several places, which one to explore; the first until someone picks.
  const [placeId, setPlaceId] = useState<string | null>(null);
  // Answers by place and category: "<placeId>:food".
  const [lists, setLists] = useState<Record<string, RecommendationList>>({});
  const [error, setError] = useState<string>();
  const [inIdeas, setInIdeas] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  const tripId = trip?.id;
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');
  const places = trip?.places ?? [];
  const place = places.find((p) => p.id === placeId) ?? places[0] ?? null;
  const city = place ? cityOf(place.destination) : trip ? cityOf(trip.destination) : 'here';
  // A place that isn't on the map can't be explored; the trip's own spot stands in for one-place trips.
  const onMap = places.length > 1 ? !!place?.location : !!trip?.location;
  const key = `${place?.id ?? 'trip'}:${category}`;

  const load = useCallback(
    async (which: RecommendationCategory, where: string | null) => {
      if (!tripId) return;
      setError(undefined);
      try {
        const list = await request(`/trips/${tripId}/recommendations?category=${which}${where ? `&place=${where}` : ''}`, {
          schema: RecommendationList,
        });
        setLists((prev) => ({ ...prev, [`${where ?? 'trip'}:${which}`]: list }));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Couldn’t load places. Check your connection and try again.');
      }
    },
    [tripId],
  );

  useEffect(() => {
    if (onMap && !lists[key]) void load(category, place?.id ?? null);
  }, [onMap, category, key, lists, load, place?.id]);

  // Which places are already ideas, so they aren't added twice.
  useEffect(() => {
    if (!tripId) return;
    request(`/trips/${tripId}/ideas`, { schema: IdeaList })
      .then((data) => setInIdeas(new Set(data.ideas.map((i) => i.placeRef).filter((r): r is string => !!r))))
      .catch(() => undefined);
  }, [tripId]);

  if (!trip) return null;

  const addToIdeas = async (place: Recommendation) => {
    setAdding(place.id);
    try {
      await request(`/trips/${trip.id}/ideas`, {
        method: 'POST',
        body: {
          id: newId(),
          title: place.name,
          note: place.description ?? place.kind,
          url: place.url,
          type: place.category === 'food' ? 'meal' : 'activity',
          latitude: place.latitude,
          longitude: place.longitude,
          placeRef: place.id,
          imageUrl: place.imageUrl,
        },
        schema: Idea,
      });
      setInIdeas((prev) => new Set(prev).add(place.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t add it. Try again.');
    } finally {
      setAdding(null);
    }
  };

  const list = lists[key];

  const explored = place?.destination ?? trip.destination;
  const renderPlace = ({ item: place }: { item: Recommendation }) => {
    const added = inIdeas.has(place.id);
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          {place.imageUrl ? (
            <Image source={{ uri: place.imageUrl }} style={styles.photo} contentFit="cover" transition={120} />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <Feather name={CATEGORY_META[place.category].icon} size={22} color={colors.accent} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name} numberOfLines={2}>
              {place.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[place.kind, list?.region ? null : `${place.distanceKm} km from the centre`].filter(Boolean).join(' · ')}
            </Text>
            {place.description ? (
              <Body style={{ fontSize: 13 }} numberOfLines={3}>
                {place.description}
              </Body>
            ) : null}
          </View>
        </View>
        <View style={styles.actions}>
          {canEdit ? (
            added ? (
              <View style={styles.added}>
                <Feather name="check" size={14} color={colors.accentInk} />
                <Text style={styles.addedText}>In Ideas</Text>
              </View>
            ) : (
              <Button
                label="Add to Ideas"
                onPress={() => void addToIdeas(place)}
                loading={adding === place.id}
                icon={<Feather name="plus" size={16} color={colors.onFill} />}
                style={{ minHeight: 40, paddingHorizontal: space.md }}
              />
            )
          ) : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Directions to ${place.name}`}
            onPress={() => openDirections(place.name, explored, place)}
            style={styles.link}
          >
            <Feather name="navigation" size={14} color={colors.accent} />
            <Text style={styles.linkText}>Directions</Text>
          </Pressable>
          {place.url ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`More about ${place.name}`}
              onPress={() => void Linking.openURL(place.url!)}
              style={styles.link}
            >
              <Feather name="external-link" size={14} color={colors.accent} />
              <Text style={styles.linkText}>More</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Title>Explore {city}</Title>
        <Body style={{ fontSize: 13 }}>
          {canEdit
            ? 'Places to go near the destination. Add the good ones to Ideas so everyone can vote.'
            : 'Places to go near the destination.'}
        </Body>
      </View>

      {places.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.places} style={{ flexGrow: 0 }}>
          {places.map((p) => {
            const on = p.id === place?.id;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="tab"
                aria-selected={on}
                onPress={() => setPlaceId(p.id)}
                style={[styles.placeChip, on && styles.placeChipOn]}
              >
                <Feather name="map-pin" size={13} color={on ? colors.accentInk : colors.muted} />
                <Text style={[styles.chipText, on && { color: colors.accentInk }]}>{cityOf(p.destination)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {!onMap ? (
        <View style={styles.center}>
          <Feather name="map-pin" size={28} color={colors.accent} />
          <Body style={{ textAlign: 'center' }}>
            {places.length > 1 ? `${city} isn’t on the map yet.` : 'This trip’s destination isn’t on the map yet.'} Pick it from
            the suggestions in Edit trip to see places to go.
          </Body>
          {canEdit ? <Button label="Set the location" onPress={() => router.push(`/trips/${trip.id}/edit`)} /> : null}
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
            {RECOMMENDATION_CATEGORIES.map((c) => {
              const on = c === category;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="tab"
                  aria-selected={on}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Feather name={CATEGORY_META[c].icon} size={14} color={on ? colors.onFill : colors.ink} />
                  <Text style={[styles.chipText, on && { color: colors.onFill }]}>{CATEGORY_META[c].label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {error && !list ? (
            <View style={styles.center}>
              <Body style={{ textAlign: 'center' }}>{error}</Body>
              <Button label="Try again" variant="outline" onPress={() => void load(category, place?.id ?? null)} />
            </View>
          ) : !list ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
              <Body style={{ textAlign: 'center' }}>Finding places near {city}… The first look can take a few seconds.</Body>
            </View>
          ) : (
            <FlatList
              data={list.places}
              keyExtractor={(p) => p.id}
              renderItem={renderPlace}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <>
                  {!canEdit ? <Body style={{ fontSize: 13 }}>{VIEWER_NOTE}</Body> : null}
                  {list.partial && list.places.length > 0 ? (
                    <Body style={{ fontSize: 13, color: colors.coralInk }}>
                      Some sources were busy, so this list may be shorter than usual. Try again later for more.
                    </Body>
                  ) : null}
                  {error ? <Body style={{ fontSize: 13, color: colors.coralInk }}>{error}</Body> : null}
                </>
              }
              ListEmptyComponent={
                list.partial ? (
                  // Empty because sources were busy, not because there's nothing: say so, and offer a retry.
                  <View style={styles.center}>
                    <Body style={{ textAlign: 'center' }}>Couldn’t load places right now. Try again.</Body>
                    <Button label="Try again" variant="outline" onPress={() => void load(category, place?.id ?? null)} />
                  </View>
                ) : (
                  <View style={styles.center}>
                    <Body style={{ textAlign: 'center' }}>
                      Nothing found in this category near {city}. Try another one.
                    </Body>
                  </View>
                )
              }
              ListFooterComponent={<Text style={styles.attribution}>{list.attribution}</Text>}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.xs },
  back: { width: 44, height: 44, marginLeft: -space.md, alignItems: 'center', justifyContent: 'center' },
  places: { gap: space.sm, paddingHorizontal: space.xl, paddingTop: space.md },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  placeChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chips: { gap: space.sm, paddingHorizontal: space.xl, paddingVertical: space.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  list: { paddingHorizontal: space.xl, paddingBottom: 60, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.md, gap: space.md },
  cardTop: { flexDirection: 'row', gap: space.md },
  photo: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.line },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  meta: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  added: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  addedText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accentInk },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: space.sm },
  linkText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  attribution: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: space.md },
});
