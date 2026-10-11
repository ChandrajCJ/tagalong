// MapLibre GL draws maps with a web worker, and browsers only run workers
// from the app's own site. This copies the worker into public/, which the
// web app serves at its root. Runs after every install.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('maplibre-gl/package.json'));
mkdirSync(join(here, '..', 'public'), { recursive: true });
copyFileSync(join(dist, 'dist', 'maplibre-gl-worker.mjs'), join(here, '..', 'public', 'maplibre-gl-worker.js'));
