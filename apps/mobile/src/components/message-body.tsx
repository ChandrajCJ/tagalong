import { mentionSegments, type Person } from '@tagalong/shared';
import { Text, type TextStyle } from 'react-native';
import { colors, fonts } from '@/theme';
import { linkify } from './linked-text';

interface Props {
  text: string;
  /** The people this message mentions, so "@Priya" can be highlighted. */
  mentioned: Person[];
  me: string | undefined;
  /** On my own (accent) bubble, highlights need to read on the dark colour. */
  onAccent: boolean;
  style: TextStyle;
}

/** A message's text: @mentions highlighted (yours stands out), links and phone numbers tappable. */
export function MessageBody({ text, mentioned, me, onAccent, style }: Props) {
  const link: TextStyle = { color: onAccent ? colors.onFill : colors.accent, fontFamily: fonts.medium, textDecorationLine: 'underline' };
  return (
    <Text style={style}>
      {mentionSegments(text, mentioned).map((segment, i) => {
        if (!segment.userId) return linkify(segment.text, link, `${i}-`);
        const isMe = segment.userId === me;
        return (
          <Text
            key={i}
            style={[
              { fontFamily: fonts.bold, color: onAccent ? colors.onFill : colors.accent },
              isMe && { backgroundColor: onAccent ? colors.onFillWash : colors.accentSoft, borderRadius: 4 },
            ]}
          >
            {segment.text}
          </Text>
        );
      })}
    </Text>
  );
}
