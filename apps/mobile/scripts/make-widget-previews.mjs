// Draws the pictures Android's widget picker shows for the two home-screen
// widgets (see src/widget/trip-widget.tsx). Run: node scripts/make-widget-previews.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = fileURLToPath(new URL('../assets/widget-preview/', import.meta.url));
mkdirSync(dir, { recursive: true });

// The light palette's surface, ink, muted and accent, and the first cover colour.
const SURFACE = '#FFFFFF';
const INK = '#1C1B19';
const MUTED = '#5E5A52';
const ACCENT = '#0E6B5C';
const COVER = '#D8A47F';
const FONT = 'font-family="Roboto, Helvetica, Arial, sans-serif"';

const countdown = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="440">
  <rect width="440" height="440" rx="88" fill="${COVER}"/>
  <text x="56" y="120" ${FONT} font-size="64" font-weight="700" fill="${INK}">Goa</text>
  <text x="56" y="384" ${FONT} font-size="80" font-weight="700" fill="${INK}">in 4 days</text>
</svg>`;

const today = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="440">
  <rect width="1000" height="440" rx="88" fill="${SURFACE}" stroke="#E4DED4" stroke-width="4"/>
  <circle cx="80" cy="96" r="22" fill="${COVER}"/>
  <text x="124" y="114" ${FONT} font-size="54" font-weight="700" fill="${INK}">Goa</text>
  <text x="250" y="114" ${FONT} font-size="46" fill="${ACCENT}">Day 2 of 5</text>
  <text x="56" y="232" ${FONT} font-size="66" font-weight="700" fill="${INK}">13:00  Beach shack lunch</text>
  <text x="56" y="300" ${FONT} font-size="48" fill="${ACCENT}">in 25 min</text>
  <text x="56" y="384" ${FONT} font-size="46" fill="${MUTED}">Flight GOI → BOM · Thu 18:00</text>
</svg>`;

await sharp(Buffer.from(countdown)).png().toFile(`${dir}countdown.png`);
await sharp(Buffer.from(today)).png().toFile(`${dir}today.png`);
console.log('Widget previews written to assets/widget-preview/');
