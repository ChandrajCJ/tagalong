import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsAround } from '@tagalong/shared';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { maplibregl } from '@/lib/maplibre-web';
import { colors } from '@/theme';
import { MAP_STYLE_URL } from './trip-map.types';
import type { PhotoMapProps } from './photo-map.types';

/**
 * The album on a map in a browser: MapLibre GL with OpenFreeMap (free, no
 * key). One pin per place, showing a photo from it and how many were taken
 * there. Metro picks this file over photo-map.tsx when bundling for the web.
 */
export function PhotoMap({ places, photosById, onOpenPlace }: PhotoMapProps) {
  const holder = useRef<View>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const open = useRef(onOpenPlace);
  open.current = onOpenPlace;

  useEffect(() => {
    const el = holder.current as unknown as HTMLElement | null;
    const bounds = boundsAround(places);
    if (!el || !bounds) return;
    map.current = new maplibregl.Map({
      container: el,
      style: MAP_STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 60 },
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // Framed once, around everything; panning afterwards is the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = places.map((place) => {
      const count = place.photoIds.length;
      const cover = photosById.get(place.photoIds[0]!);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.setAttribute('aria-label', `${count} ${count === 1 ? 'photo' : 'photos'} here`);
      Object.assign(pin.style, {
        position: 'relative',
        width: '52px',
        height: '52px',
        padding: '0',
        borderRadius: '12px',
        border: `3px solid ${colors.onPhoto}`,
        background: cover?.thumbUrl ? `center / cover no-repeat url("${cover.thumbUrl}")` : colors.accentSoft,
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        cursor: 'pointer',
      });
      if (count > 1) {
        const badge = document.createElement('span');
        badge.textContent = String(count);
        Object.assign(badge.style, {
          position: 'absolute',
          top: '-10px',
          right: '-10px',
          minWidth: '22px',
          height: '22px',
          padding: '0 5px',
          borderRadius: '11px',
          border: `2px solid ${colors.onPhoto}`,
          background: colors.coral,
          color: colors.onPhoto,
          font: '600 11px sans-serif',
          lineHeight: '18px',
          boxSizing: 'border-box',
        });
        pin.appendChild(badge);
      }
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        open.current(place);
      });
      return new maplibregl.Marker({ element: pin }).setLngLat([place.longitude, place.latitude]).addTo(m);
    });
  }, [places, photosById]);

  return <View ref={holder} style={{ flex: 1 }} />;
}
