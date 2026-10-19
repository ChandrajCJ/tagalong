import { Linking, Text, type TextStyle } from 'react-native';
import { colors, fonts } from '@/theme';

/** Web links, and phone numbers with at least 7 digits ("+351 21 123 4567", "112" is too short to guess). */
const LINK = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|\+?\d[\d ()-]{5,}\d)/g;

const targetOf = (part: string) => {
  if (/^\d|^\+/.test(part)) {
    const digits = part.replace(/[^\d+]/g, '');
    return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
  }
  // Trailing punctuation belongs to the sentence, not the link.
  const clean = part.replace(/[.,;:!?)]+$/, '');
  return clean.startsWith('www.') ? `https://${clean}` : clean;
};

/** The text with its links and phone numbers made tappable, to put inside a <Text>. */
export const linkify = (text: string, linkStyle: TextStyle, keyPrefix = '') =>
  text.split(LINK).map((part, i) => {
    const target = i % 2 === 1 ? targetOf(part) : null;
    if (!target) return part;
    return (
      <Text key={`${keyPrefix}${i}`} accessibilityRole="link" onPress={() => void Linking.openURL(target)} style={linkStyle}>
        {part}
      </Text>
    );
  });

/** Plain text where links and phone numbers can be tapped. */
export function LinkedText({ text, style }: { text: string; style?: TextStyle }) {
  return (
    <Text style={style} selectable>
      {linkify(text, { color: colors.accent, fontFamily: fonts.medium, textDecorationLine: 'underline' })}
    </Text>
  );
}
