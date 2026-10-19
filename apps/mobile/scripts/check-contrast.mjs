// Checks both palettes keep text readable (WCAG AA). Run: pnpm check:contrast
import { CONTRAST_PAIRS, COVER_TEXT_PAIRS, dark, light } from '../src/palette.ts';

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failed = 0;
for (const [name, palette] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const r = ratio(palette[fg], palette[bg]);
    const ok = r >= min;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`);
  }
}
for (const [fg, bg] of COVER_TEXT_PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} cover text on ${bg}: ${r.toFixed(2)} (needs 4.5)`);
}
if (failed) {
  console.error(`${failed} colour pairs are too close.`);
  process.exit(1);
}
