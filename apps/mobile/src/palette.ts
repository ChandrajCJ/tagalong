// Colours for the light and dark looks, with the same names in both. Plain
// data, so a script can check their contrast without React Native.

export const light = {
  bg: '#F6F3EE',
  surface: '#FFFFFF',
  /** A faint wash on a surface, e.g. an idea already in the plan. */
  surfaceTint: '#FBFDFC',
  line: '#E4DED4',
  lineStrong: '#D6CFC3',
  /** Thin rules between rows. */
  divider: '#EFEAE2',
  /** Behind segmented controls and activity cards. */
  track: '#ECE7DF',
  ink: '#1C1B19',
  muted: '#5E5A52',
  /** Placeholders, chevrons, past days: present but quiet. */
  faint: '#8C867B',
  accent: '#0E6B5C',
  accentSoft: '#DCEDE8',
  accentInk: '#0A4A40',
  /** Faint accent behind a quote, and the empty part of a progress bar. */
  accentWash: 'rgba(14,107,92,0.08)',
  accentTrack: 'rgba(14,107,92,0.2)',
  onAccentMuted: '#D5EAE4',
  /** Text and icons on anything filled with accent, ink, coral or danger. */
  onFill: '#FFFFFF',
  /** Quieter text on those fills, like the weekday on the chosen day. */
  onFillMuted: '#E4DED4',
  /** A light wash on those fills, e.g. a quote inside my own bubble. */
  onFillWash: 'rgba(255,255,255,0.16)',
  coral: '#B54A28',
  coralInk: '#A8431F',
  coralSoft: '#F8E3DA',
  danger: '#A8431F',
  violet: '#5B4E86',
  rain: '#3F6E8C',
  /** A day's note in the plan: warm, like paper. */
  note: '#FBF3DC',
  /** Behind sheets and menus. */
  overlay: 'rgba(28,27,25,0.45)',
  shadow: '#000000',
  /** Text on a trip's cover colour, which stays the same in both looks. */
  onCover: '#1C1B19',
  /** On photos, covers, maps and the photo viewer: always white, whatever the look. */
  onPhoto: '#FFFFFF',
  onPhotoMuted: '#D9D9D9',
  photoBg: '#000000',
  /** A video that has no picture yet. */
  mediaPlaceholder: '#2A2925',
  heart: '#FF6B6B',
};

export type Palette = typeof light;

export const dark: Palette = {
  bg: '#121210',
  surface: '#1C1B18',
  surfaceTint: '#1A201E',
  line: '#2E2C28',
  lineStrong: '#3D3A34',
  divider: '#26241F',
  track: '#2A2824',
  ink: '#F1EEE8',
  muted: '#ABA59A',
  faint: '#857F74',
  // A lighter green, so it reads as text on the dark background; fills carry dark text.
  accent: '#5BC0A9',
  accentSoft: '#173A33',
  accentInk: '#9EDCCD',
  accentWash: 'rgba(91,192,169,0.10)',
  accentTrack: 'rgba(91,192,169,0.25)',
  onAccentMuted: '#1D4A40',
  onFill: '#0F1A17',
  onFillMuted: '#3B4A46',
  onFillWash: 'rgba(0,0,0,0.12)',
  coral: '#EE9372',
  coralInk: '#F2A88C',
  coralSoft: '#3D241B',
  danger: '#F2A88C',
  violet: '#A99BE0',
  rain: '#8DB8D6',
  note: '#2E2818',
  overlay: 'rgba(0,0,0,0.6)',
  onCover: '#1C1B19',
  shadow: '#000000',
  onPhoto: '#FFFFFF',
  onPhotoMuted: '#D9D9D9',
  photoBg: '#000000',
  mediaPlaceholder: '#2A2925',
  heart: '#FF6B6B',
};

/** Pairs that must stay readable (WCAG AA: 4.5 for text, 3 for large text and icons). */
export const CONTRAST_PAIRS: [fg: keyof Palette, bg: keyof Palette, min: number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accentInk', 'accentSoft', 4.5],
  ['onFill', 'accent', 4.5],
  ['onFill', 'ink', 4.5],
  ['onFill', 'coral', 4.5],
  ['coralInk', 'coralSoft', 4.5],
  ['danger', 'surface', 4.5],
  ['faint', 'surface', 3],
  ['onAccentMuted', 'accent', 3],
];

/** The cover colours stay the same in both looks, so their text does too. */
export const COVER_TEXT_PAIRS: [fg: string, bg: string][] = ['#D8A47F', '#8FA6A0', '#6F8A99', '#7E8C6B'].map((c) => [light.onCover, c]);
