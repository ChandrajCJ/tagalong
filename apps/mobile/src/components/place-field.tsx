import Feather from '@expo/vector-icons/Feather';
import { IdeaList, PlaceSearch, type Idea, type PlaceResult } from '@tagalong/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/lib/api';
import { colors, fonts, radius, space } from '@/theme';
import { Field } from './ui';

/** What picking a suggestion gives: a name to show and a spot on the map. */
export interface PickedPlace {
  name: string;
  /** "Av. 24 de Julho, Lisbon", when the map knows it. */
  address: string | null;
  latitude: number;
  longitude: number;
  placeRef: string | null;
}

interface Props {
  label: string;
  value: string;
  /** True while the text is a place picked from the suggestions, so it's on the map. */
  picked: boolean;
  /** The trip to search around, and whose ideas to suggest first. */
  tripId: string;
  onChangeText: (text: string) => void;
  onPick: (place: PickedPlace) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  /** Show suggestions for what's already there without waiting for typing ("Find on map"). */
  searchNow?: boolean;
  /** What to say once a place is picked. */
  pickedHint?: string;
}

type Suggestion = { key: string; place: PickedPlace; detail: string | null; fromIdea: boolean };

const fromIdea = (i: Idea): Suggestion => ({
  key: `idea:${i.id}`,
  place: { name: i.title, address: null, latitude: i.latitude!, longitude: i.longitude!, placeRef: i.placeRef },
  detail: i.promotedItemId ? 'Already in the plan' : 'An idea on the board',
  fromIdea: true,
});

const fromSearch = (r: PlaceResult): Suggestion => ({
  key: r.id,
  place: { name: r.name, address: r.address, latitude: r.latitude, longitude: r.longitude, placeRef: r.id },
  detail: [r.kind, r.address ?? r.label.split(', ').slice(1).join(', ')].filter(Boolean).join(' · ') || null,
  fromIdea: false,
});

/**
 * A place in or around the trip's destination, suggested as you type
 * (OpenStreetMap through our API, with the trip's own ideas first). Picking
 * one puts it on the map; typing anything else still works, just without a pin.
 */
export function PlaceField(props: Props) {
  const { label, value, picked, tripId, onChangeText, onPick, placeholder, editable = true, autoFocus, searchNow } = props;
  const pickedHint = props.pickedHint ?? 'On the map, with travel times and directions.';
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Only search once someone types (or asks), not for every saved place on opening.
  const [active, setActive] = useState(!!searchNow);
  const latest = useRef(0);

  useEffect(() => {
    if (!editable) return;
    request(`/trips/${tripId}/ideas`, { schema: IdeaList })
      .then((data) => setIdeas(data.ideas.filter((i) => i.latitude !== null && i.longitude !== null)))
      .catch(() => undefined);
  }, [tripId, editable]);

  useEffect(() => {
    const query = value.trim();
    if (picked || !active || query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    // Wait for a pause in typing, and ignore answers to older searches.
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(() => {
      request(`/places/search?scope=place&tripId=${tripId}&q=${encodeURIComponent(query)}`, { schema: PlaceSearch })
        .then((data) => ticket === latest.current && setResults(data.results))
        .catch(() => ticket === latest.current && setResults([]))
        .finally(() => ticket === latest.current && setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [value, picked, active, tripId]);

  const query = value.trim().toLowerCase();
  const ideaMatches = picked || !active || query.length < 2 ? [] : ideas.filter((i) => i.title.toLowerCase().includes(query)).slice(0, 3);
  const ideaRefs = new Set(ideaMatches.map((i) => i.placeRef).filter(Boolean));
  const suggestions = [...ideaMatches.map(fromIdea), ...results.filter((r) => !ideaRefs.has(r.id)).map(fromSearch)];

  return (
    <View style={{ gap: 6 }}>
      <Field
        label={label}
        value={value}
        onChangeText={(text) => {
          setActive(true);
          onChangeText(text);
        }}
        placeholder={placeholder}
        editable={editable}
        autoFocus={autoFocus}
        autoCorrect={false}
      />
      {!editable ? null : picked ? (
        <View style={styles.row}>
          <Feather name="map-pin" size={13} color={colors.accent} />
          <Text style={styles.pickedText}>{pickedHint}</Text>
        </View>
      ) : suggestions.length > 0 ? (
        <View style={styles.list} accessibilityRole="list">
          {suggestions.map((s, i) => (
            <View key={s.key}>
              {i === 0 && s.fromIdea ? <Text style={styles.section}>From Ideas</Text> : null}
              {!s.fromIdea && (i === 0 || suggestions[i - 1]!.fromIdea) && ideaMatches.length > 0 ? (
                <Text style={[styles.section, styles.divider]}>On the map</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s.place.name}${s.detail ? `, ${s.detail}` : ''}`}
                onPress={() => {
                  setActive(false);
                  onPick(s.place);
                }}
                style={[styles.option, i > 0 && !(s.fromIdea === false && suggestions[i - 1]!.fromIdea) && styles.divider]}
              >
                <Feather name={s.fromIdea ? 'star' : 'map-pin'} size={15} color={s.fromIdea ? colors.coral : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionName} numberOfLines={1}>
                    {s.place.name}
                  </Text>
                  {s.detail ? (
                    <Text style={styles.optionDetail} numberOfLines={1}>
                      {s.detail}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      ) : searching ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.hint}>Looking for places…</Text>
        </View>
      ) : active && query.length >= 2 ? (
        <Text style={styles.hint}>No matching places nearby. What you typed is kept, just without a pin on the map.</Text>
      ) : (
        <Text style={styles.hint}>Pick a suggestion to put it on the map.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  section: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: space.md, paddingTop: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  optionName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  optionDetail: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickedText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
