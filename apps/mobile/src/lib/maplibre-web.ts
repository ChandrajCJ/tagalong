import * as maplibregl from 'maplibre-gl';

/**
 * MapLibre GL for the web app, with its worker loaded from our own site
 * (copied into public/ on install), since browsers refuse workers from
 * elsewhere and the bundler doesn't emit one.
 */
maplibregl.setWorkerUrl('/maplibre-gl-worker.js');

export { maplibregl };
