// Tokens taken from the design canvas (Group Trip App UX Flow).
export const colors = {
  bg: '#F6F3EE',
  surface: '#FFFFFF',
  line: '#E4DED4',
  lineStrong: '#D6CFC3',
  ink: '#1C1B19',
  muted: '#5E5A52',
  accent: '#0E6B5C',
  accentSoft: '#DCEDE8',
  accentInk: '#0A4A40',
  onAccentMuted: '#D5EAE4',
  coral: '#B54A28',
  coralInk: '#A8431F',
  coralSoft: '#F8E3DA',
  danger: '#A8431F',
} as const;

export const coverColors = ['#D8A47F', '#8FA6A0', '#6F8A99', '#7E8C6B'] as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_600SemiBold',
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
