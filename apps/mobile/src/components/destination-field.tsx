import Feather from '@expo/vector-icons/Feather';
import { PlaceSearch, type PlaceResult } from '@tagalong/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { request } from '@/lib/api';
import { colors, fonts, radius, space } from '@/theme';
import { Field } from './ui';

interface Props {
  value: string;
  /** True once the text is a place picked from the suggestions. */
  picked: boolean;
  onChangeText: (text: string) => void;
  onPick: (place: PlaceResult) => void;
  error?: string;
  autoFocus?: boolean;
}

/**
 * The destination, with real places suggested as you type (OpenStreetMap,
 * through our API). Picking one gives the trip maps, weather and things to
 * do; typing anything else still works, just without those.
 */
export function DestinationField({ value, picked, onChangeText, onPick, error, autoFocus }: Props) {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const query = value.trim();
    if (picked || query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    // Wait for a pause in typing, and ignore answers to older searches.
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(() => {
      request(`/places/search?q=${encodeURIComponent(query)}`, { schema: PlaceSearch })
        .then((data) => {
          if (ticket !== latest.current) return;
          setResults(data.results);
          setOpen(true);
        })
        .catch(() => ticket === latest.current && setResults([]))
        .finally(() => ticket === latest.current && setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [value, picked]);

  return (
    <View style={{ gap: 6 }}>
      <Field
        label="Destination"
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          setOpen(true);
        }}
        placeholder="Start typing a city or region, e.g. Goa"
        error={error}
        autoFocus={autoFocus}
        autoCorrect={false}
      />
      {picked ? (
        <View style={styles.pickedRow}>
          <Feather name="map-pin" size={13} color={colors.accent} />
          <Text style={styles.pickedText}>On the map: you’ll get weather, a trip map and places to go.</Text>
        </View>
      ) : searching ? (
        <View style={styles.pickedRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.hint}>Looking for places…</Text>
        </View>
      ) : open && results.length > 0 ? (
        <View style={styles.list} accessibilityRole="list">
          {results.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={`${r.label}${r.kind ? `, ${r.kind}` : ''}`}
              onPress={() => {
                setOpen(false);
                onPick(r);
              }}
              style={[styles.option, i > 0 && styles.divider]}
            >
              <Feather name="map-pin" size={15} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionName} numberOfLines={1}>
                  {r.label}
                </Text>
                {r.kind ? <Text style={styles.optionKind}>{r.kind}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : value.trim().length >= 2 && open ? (
        <Text style={styles.hint}>No matching places. You can keep what you typed, but there won’t be maps or tips.</Text>
      ) : (
        <Text style={styles.hint}>Pick a suggestion to get weather, a trip map and places to go.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  optionName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  optionKind: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickedText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
