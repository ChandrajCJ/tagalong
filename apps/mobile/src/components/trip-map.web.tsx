import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { maplibregl } from '@/lib/maplibre-web';
import { colors, fonts } from '@/theme';
import { MAP_STYLE_URL, type TripMapProps } from './trip-map.types';

/** The trip map in a browser: MapLibre GL with OpenFreeMap, free and keyless. */
export function TripMap({ pins, bounds, selectedId, onPressPin, line }: TripMapProps) {
  const holder = useRef<View>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onPress = useRef(onPressPin);
  onPress.current = onPressPin;

  // Created once; framed around the pins it opens with.
  useEffect(() => {
    const el = holder.current as unknown as HTMLElement | null;
    if (!el) return;
    map.current = new maplibregl.Map({
      container: el,
      style: MAP_STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 50 },
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins are redrawn whenever they or the selection change.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = pins.map((pin) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', pin.title);
      dot.textContent = pin.label;
      const selected = pin.id === selectedId;
      Object.assign(dot.style, {
        minWidth: '30px',
        height: '30px',
        padding: '0 6px',
        borderRadius: '15px',
        border: `2.5px solid ${selected ? colors.ink : pin.outlined ? pin.color : '#FFFFFF'}`,
        background: pin.outlined ? '#FFFFFF' : pin.color,
        color: pin.outlined ? pin.color : '#FFFFFF',
        font: `600 12px ${fonts.bold}, sans-serif`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        transform: selected ? 'scale(1.25)' : 'none',
      });
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        onPress.current(pin);
      });
      return new maplibregl.Marker({ element: dot }).setLngLat([pin.longitude, pin.latitude]).addTo(m);
    });
  }, [pins, selectedId]);

  // The day's route, under the pins. The style has to finish loading before a layer can be added.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const data = {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: line?.coordinates ?? [] },
      };
      const source = m.getSource('route') as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        m.addSource('route', { type: 'geojson', data });
        m.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': line?.color ?? colors.accent, 'line-width': 4, 'line-opacity': 0.85 },
        });
      }
      if (line) m.setPaintProperty('route-line', 'line-color', line.color);
    };
    if (m.isStyleLoaded()) draw();
    else m.once('load', draw);
    return () => {
      m.off('load', draw);
    };
  }, [line]);

  return <View ref={holder} style={{ flex: 1 }} />;
}
