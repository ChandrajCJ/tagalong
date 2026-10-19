// Makes every app icon, splash and favicon from one drawing: concept A, "Tag along"
// (docs/plans/icon-concepts.png): a green pin with a coral pin tagging along
// behind it over a faint dotted trail, on cream. Run: pnpm make:icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = (name) => fileURLToPath(new URL(`../assets/images/${name}`, import.meta.url));
const brand = (name) => fileURLToPath(new URL(`../assets/brand/${name}`, import.meta.url));

const CREAM = '#F6F3EE';
const GREEN = '#0E6B5C';
const CORAL = '#B54A28';
const INK = '#1C1B19';
const DARK_BG = '#121210';
// The dark look's own greens and corals, which read on near-black.
const DARK_GREEN = '#5BC0A9';
const DARK_CORAL = '#EE9372';

/** A map pin, tip at the bottom, centred on its round head. */
const PIN = 'M 0 -200 C 115 -200 200 -118 200 -12 C 200 110 62 222 0 300 C -62 222 -200 110 -200 -12 C -200 -118 -115 -200 0 -200 Z';
// Where the two pins sit, in a 1024 square, before any scaling for the safe zone.
const CORAL_AT = 'translate(640 500) scale(0.82)';
const GREEN_AT = 'translate(430 440)';
// Centre of the pair's bounding box, so scaling keeps it in the middle.
const PAIR_CENTRE = [516, 490];

const trail = () =>
  `<path d="M 250 830 Q 512 760 774 830" fill="none" stroke="${INK}" stroke-opacity="0.18" stroke-width="22" stroke-linecap="round" stroke-dasharray="2 46"/>`;

/**
 * The two pins in colour, each with a hole the colour of `gap`, and a ring of
 * that colour round each pin so they separate cleanly when small.
 */
const pins = ({ green = GREEN, coral = CORAL, gap = CREAM } = {}) => `
  <g transform="${CORAL_AT}"><path d="${PIN}" fill="${coral}" stroke="${gap}" stroke-width="30"/><circle cx="0" cy="-14" r="74" fill="${gap}"/></g>
  <g transform="${GREEN_AT}"><path d="${PIN}" fill="${green}" stroke="${gap}" stroke-width="26"/><circle cx="0" cy="-14" r="76" fill="${gap}"/></g>`;

/**
 * The pins as one shape of one colour, with the holes and the gap between them
 * cut out: for Android's themed icons and the splash, which colour it themselves.
 */
const silhouette = (colour, id) => `
  <defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
    <rect width="1024" height="1024" fill="black"/>
    <g transform="${CORAL_AT}"><path d="${PIN}" fill="white"/><circle cx="0" cy="-14" r="74" fill="black"/></g>
    <g transform="${GREEN_AT}"><path d="${PIN}" fill="white" stroke="black" stroke-width="26"/><circle cx="0" cy="-14" r="76" fill="black"/></g>
  </mask></defs>
  <rect width="1024" height="1024" fill="${colour}" mask="url(#${id})"/>`;

/** Shrinks and centres the pins, e.g. into the adaptive icon's safe circle. */
const fit = (content, scale) => {
  const [cx, cy] = PAIR_CENTRE;
  return `<g transform="translate(512 512) scale(${scale}) translate(${-cx} ${-cy})">${content}</g>`;
};

const svg = (body, background) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${
    background ? `<rect width="1024" height="1024" fill="${background}"/>` : ''
  }${body}</svg>`;

const png = async (name, source, size = 1024) => {
  await sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toBuffer().then((b) => writeFileSync(out(name), b));
  console.log(`${name} (${size}²)`);
};

mkdirSync(fileURLToPath(new URL('../assets/images/', import.meta.url)), { recursive: true });

// The refined drawing itself, kept as the source of truth next to the original concept.
const refined = svg(`${trail()}${pins()}`, CREAM);
writeFileSync(brand('icon.svg'), refined);

// The icon everywhere a square one is used (iOS, the store, older Androids).
await png('icon.png', svg(fit(`${trail()}${pins()}`, 0.92), CREAM));
// Android's adaptive icon: the pins inside the central 66% circle that every
// launcher shape keeps; the trail is dropped, it's lost at launcher size.
// The pair's half-diagonal is about 398 units; 0.85 brings it inside the 338-unit safe radius.
await png('android-icon-foreground.png', svg(fit(pins(), 0.85)));
await png('android-icon-background.png', svg('', CREAM));
// Android 13's themed icons tint a single-colour shape.
await png('android-icon-monochrome.png', svg(fit(silhouette('#FFFFFF', 'mono'), 0.85)));
// Splash: the pins in cream on the green background app.json sets…
await png('splash-icon.png', svg(fit(silhouette(CREAM, 'splash'), 0.9)), 512);
// …and on near-black for the dark look, in its own colours.
await png('splash-icon-dark.png', svg(fit(pins({ green: DARK_GREEN, coral: DARK_CORAL, gap: DARK_BG }), 0.9)), 512);
// The browser tab: pins only, no trail (browsers also shrink it to 32).
await png('favicon.png', svg(fit(pins(), 1.6)), 48);
