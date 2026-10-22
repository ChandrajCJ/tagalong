import Feather from '@expo/vector-icons/Feather';
import { MAX_JOURNAL_COMMENT, REACTIONS, type JournalEntry, type Photo } from '@tagalong/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAction } from '@/lib/confirm';
import { MOOD_LABELS } from '@/lib/journal';
import { colors, fonts, radius, space } from '@/theme';
import { LinkedText } from './linked-text';
import { Avatar, Body } from './ui';

interface Props {
  entry: JournalEntry;
  me: string;
  /** Trip owners can remove anyone's group entry or comment, like in the chat. */
  isOwner: boolean;
  avatarColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onComment: (body: string) => Promise<string | null>;
  onDeleteComment: (commentId: string) => void;
  onOpenPhoto: (photo: Photo, all: Photo[]) => void;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** One journal entry: who, when, what, the photos, and the group's reactions and comments. */
export function JournalEntryCard({ entry: e, me, isOwner, avatarColor, onEdit, onDelete, onReact, onComment, onDeleteComment, onOpenPhoto }: Props) {
  const [reacting, setReacting] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const mine = e.authorId === me;
  const shared = e.visibility === 'group';
  const author = mine ? 'You' : e.authorName;

  const sendComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    const error = await onComment(comment);
    setSending(false);
    if (error) setProblem(error);
    else {
      setComment('');
      setProblem(undefined);
    }
  };

  const remove = async () => {
    if (await confirmAction('Delete this entry?', mine ? 'It’s gone for everyone.' : `${e.authorName} wrote this. It’s gone for everyone.`, 'Delete')) onDelete();
  };

  return (
    <View style={[styles.card, !shared && styles.private]}>
      <View style={styles.head}>
        <Avatar name={e.authorName} userId={e.authorId} color={avatarColor} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>
            {author}
            {e.kind === 'quote' ? <Text style={styles.soft}> saved a quote</Text> : null}
          </Text>
          <Body style={{ fontSize: 12 }}>
            {timeOf(e.createdAt)}
            {shared ? '' : ' · 🔒 Just me'}
          </Body>
        </View>
        {e.mood ? (
          <Text accessibilityLabel={`Mood: ${MOOD_LABELS[e.mood]}`} style={{ fontSize: 22 }}>
            {e.mood}
          </Text>
        ) : null}
        {mine ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Edit this entry" onPress={onEdit} style={styles.icon}>
            <Feather name="edit-2" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
        {mine || (isOwner && shared) ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Delete this entry" onPress={() => void remove()} style={styles.icon}>
            <Feather name="trash-2" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {e.kind === 'quote' ? (
        <View style={styles.quote}>
          <Text style={styles.quoteText}>“{e.body}”</Text>
          <Body style={{ fontSize: 13 }}>
            {e.quote?.senderName ? `${e.quote.senderName} in the chat` : 'From the chat'}
            {e.quote?.sentAt ? `, ${timeOf(e.quote.sentAt)}` : ''}
          </Body>
        </View>
      ) : (
        <LinkedText text={e.body} style={styles.body} />
      )}

      {e.media.length > 0 ? (
        <View style={styles.media}>
          {e.media.slice(0, 4).map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={i === 3 && e.media.length > 4 ? `${e.media.length - 3} more photos` : `${p.kind === 'video' ? 'Video' : 'Photo'} ${i + 1}`}
              onPress={() => onOpenPhoto(p, e.media)}
              style={styles.photo}
            >
              <Image source={p.thumbUrl ? { uri: p.thumbUrl, cacheKey: `${p.id}-thumb` } : undefined} contentFit="cover" style={{ flex: 1 }} />
              {i === 3 && e.media.length > 4 ? (
                <View style={styles.more}>
                  <Text style={styles.moreText}>+{e.media.length - 4}</Text>
                </View>
              ) : p.kind === 'video' ? (
                <View style={styles.play}>
                  <Feather name="play" size={14} color={colors.onFill} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {e.place ? (
        <View style={styles.place}>
          <Feather name="map-pin" size={14} color={colors.muted} />
          <Body style={{ flex: 1, fontSize: 13 }}>{e.place.label}</Body>
        </View>
      ) : null}

      {shared ? (
        <View style={styles.reactions}>
          {e.reactions.map((r) => (
            <Pressable
              key={r.emoji}
              accessibilityRole="button"
              accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
              onPress={() => onReact(r.emoji)}
              style={[styles.reaction, r.mine && styles.reactionMine]}
            >
              <Text style={styles.reactionText}>
                {r.emoji} {r.count}
              </Text>
            </Pressable>
          ))}
          {reacting ? (
            REACTIONS.filter((emoji) => !e.reactions.some((r) => r.emoji === emoji)).map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
                onPress={() => {
                  setReacting(false);
                  onReact(emoji);
                }}
                style={styles.reaction}
              >
                <Text style={styles.reactionText}>{emoji}</Text>
              </Pressable>
            ))
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Add a reaction" onPress={() => setReacting(true)} style={styles.reaction}>
              <Feather name="smile" size={14} color={colors.muted} />
            </Pressable>
          )}
        </View>
      ) : null}

      {shared ? (
        <View style={{ gap: space.xs }}>
          {e.comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Body style={{ flex: 1, fontSize: 13 }}>
                <Text style={styles.commentAuthor}>{c.authorId === me ? 'You' : c.authorName}</Text> {c.body}
              </Body>
              {c.authorId === me || isOwner ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Delete this comment" onPress={() => onDeleteComment(c.id)} style={styles.iconSmall}>
                  <Feather name="x" size={14} color={colors.faint} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <View style={styles.commentRow}>
            <TextInput
              accessibilityLabel="Add a comment"
              value={comment}
              onChangeText={setComment}
              placeholder="Add a comment"
              placeholderTextColor={colors.faint}
              maxLength={MAX_JOURNAL_COMMENT}
              onSubmitEditing={() => void sendComment()}
              style={styles.commentInput}
            />
            {comment.trim() ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Send comment" disabled={sending} onPress={() => void sendComment()} style={styles.iconSmall}>
                <Feather name="send" size={16} color={colors.accent} />
              </Pressable>
            ) : null}
          </View>
          {problem ? <Body style={{ color: colors.coralInk, fontSize: 12 }}>{problem}</Body> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  private: { backgroundColor: colors.surfaceTint, borderStyle: 'dashed' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  author: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  soft: { fontFamily: fonts.medium, color: colors.muted },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconSmall: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.ink },
  quote: { gap: 4, paddingLeft: space.md, borderLeftWidth: 3, borderLeftColor: colors.accent },
  quoteText: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24, color: colors.ink },
  media: { flexDirection: 'row', gap: space.xs },
  photo: { flex: 1, aspectRatio: 1, maxWidth: 140, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.accentWash },
  more: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  moreText: { fontFamily: fonts.bold, fontSize: 18, color: colors.onFill },
  play: { position: 'absolute', left: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  reaction: { minHeight: 32, minWidth: 40, paddingHorizontal: 10, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  reactionMine: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  reactionText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  comment: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  commentAuthor: { fontFamily: fonts.bold, color: colors.ink },
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  commentInput: { flex: 1, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
});
