import Constants, { ExecutionEnvironment } from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline, Marker as RNMarker } from 'react-native-maps';
import { colors, fonts } from '@/theme';
import { MAP_STYLE_URL, type MapPin, type TripMapProps } from './trip-map.types';

/**
 * Expo Go doesn't include MapLibre, so there the map falls back to
 * react-native-maps. Real builds use MapLibre with OpenFreeMap: free and
 * open, with no Google key (which an Android build would otherwise need).
 */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function TripMap(props: TripMapProps) {
  return inExpoGo ? <ExpoGoMap {...props} /> : <MapLibreMap {...props} />;
}

function Pin({ pin, selected }: { pin: MapPin; selected: boolean }) {
  return (
    <View
      style={[
        styles.pin,
        pin.outlined ? { backgroundColor: colors.onPhoto, borderColor: pin.color } : { backgroundColor: pin.color },
        selected && styles.pinSelected,
      ]}
    >
      <Text style={[styles.pinText, pin.outlined && { color: pin.color }]}>{pin.label}</Text>
    </View>
  );
}

function MapLibreMap({ pins, bounds, selectedId, onPressPin, line }: TripMapProps) {
  // Required here, not imported at the top: loading it in Expo Go would crash.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Map, Camera, Marker, GeoJSONSource, Layer } = require('@maplibre/maplibre-react-native') as typeof import('@maplibre/maplibre-react-native');
  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE_URL} logo={false} attribution attributionPosition={{ bottom: 8, left: 8 }}>
      <Camera initialViewState={{ bounds, padding: { top: 60, right: 40, bottom: 60, left: 40 } }} />
      {line ? (
        <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coordinates } }}>
          <Layer
            id="route-line"
            type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': line.color, 'line-width': 4, 'line-opacity': 0.85 }}
          />
        </GeoJSONSource>
      ) : null}
      {pins.map((pin) => (
        <Marker key={pin.id} id={pin.id} lngLat={[pin.longitude, pin.latitude]} onPress={() => onPressPin(pin)}>
          <View accessible accessibilityRole="button" accessibilityLabel={pin.title}>
            <Pin pin={pin} selected={pin.id === selectedId} />
          </View>
        </Marker>
      ))}
    </Map>
  );
}

function ExpoGoMap({ pins, bounds, selectedId, onPressPin, line }: TripMapProps) {
  const [w, s, e, n] = bounds;
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: (s + n) / 2, longitude: (w + e) / 2, latitudeDelta: n - s, longitudeDelta: e - w }}
      showsPointsOfInterests={false}
    >
      {line ? (
        <Polyline
          coordinates={line.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }))}
          strokeColor={line.color}
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}
      {pins.map((pin) => (
        <RNMarker
          key={`${pin.id}-${pin.id === selectedId}`}
          coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
          onPress={() => onPressPin(pin)}
          tracksViewChanges={false}
          accessibilityLabel={pin.title}
        >
          <Pin pin={pin} selected={pin.id === selectedId} />
        </RNMarker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  pin: { minWidth: 30, height: 30, paddingHorizontal: 6, borderRadius: 15, borderWidth: 2.5, borderColor: colors.onPhoto, alignItems: 'center', justifyContent: 'center', shadowColor: colors.shadow, shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  pinSelected: { transform: [{ scale: 1.25 }], borderColor: colors.ink },
  pinText: { fontFamily: fonts.bold, fontSize: 12, color: colors.onPhoto },
});
