import Feather from '@expo/vector-icons/Feather';
import {
  ChatMessage,
  hasRole,
  MessagePage,
  newId,
  type ReadState,
} from '@tagalong/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageActions } from '@/components/message-actions';
import { Avatar, Body, Button } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import {
  applyReaction,
  buildRows,
  mergeMessages,
  seenCount,
  timeOf,
  type ChatRow,
  type LocalMessage,
} from '@/lib/chat';
import { realtime, useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

/** The trip's group chat (design: Chat.dc.html). */
export default function ChatTab() {
  const { trip } = useTrip();
  const [messages, setMessages] = useState<LocalMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [readStates, setReadStates] = useState<ReadState[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [actionsFor, setActionsFor] = useState<LocalMessage | null>(null);
  const [focused, setFocused] = useState(false);
  const lastTypingSent = useRef(0);
  const lastMarkedRead = useRef<string | null>(null);

  const tripId = trip?.id;
  const me = trip?.myUserId;
  const canPost = !!trip && hasRole(trip.myRole, 'editor');

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const page = await request(`/trips/${tripId}/messages`, { schema: MessagePage });
      // Keep anything still sending; the server copy replaces the rest.
      setMessages((prev) => mergeMessages((prev ?? []).filter((m) => m.status), page.messages));
      setCursor(page.nextCursor);
      setReadStates(page.readStates);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the chat');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const loadOlder = async () => {
    if (!tripId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await request(`/trips/${tripId}/messages?before=${encodeURIComponent(cursor)}`, {
        schema: MessagePage,
      });
      setMessages((prev) => mergeMessages(prev ?? [], page.messages));
      setCursor(page.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  };

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind === 'typing') {
      if (m.typing.userId === me) return;
      setTyping((prev) => ({
        ...prev,
        [m.typing.userId]: { name: m.typing.displayName, until: Date.now() + TYPING_SHOWN_MS },
      }));
      return;
    }
    if (m.kind !== 'event') return;
    const { event } = m;
    if (event.type === 'message.created') {
      const parsed = ChatMessage.safeParse(event.payload);
      if (!parsed.success) return;
      setMessages((prev) => mergeMessages(prev ?? [], [parsed.data]));
      // Whoever sent it has stopped typing.
      if (parsed.data.senderId) {
        setTyping((prev) => {
          const next = { ...prev };
          delete next[parsed.data.senderId!];
          return next;
        });
      }
    } else if (event.type === 'reaction.changed') {
      const p = event.payload as { messageId: string; emoji: string; userId: string; added: boolean };
      setMessages(
        (prev) =>
          prev?.map((msg) =>
            msg.id === p.messageId ? applyReaction(msg, p.emoji, p.added, p.userId === me) : msg,
          ) ?? prev,
      );
    } else if (event.type === 'read.updated') {
      const p = event.payload as ReadState;
      setReadStates((prev) => [...prev.filter((r) => r.userId !== p.userId), p]);
    }
  });

  // Clear typing indicators that have gone quiet.
  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const timer = setInterval(() => {
      setTyping((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > Date.now())),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  // While the chat is on screen, mark the newest message as read.
  const newestConfirmed = messages?.find((m) => !m.status);
  useEffect(() => {
    if (!focused || !tripId || !newestConfirmed) return;
    if (lastMarkedRead.current === newestConfirmed.id) return;
    lastMarkedRead.current = newestConfirmed.id;
    void request(`/trips/${tripId}/read`, {
      method: 'POST',
      body: { messageId: newestConfirmed.id },
    }).catch(() => {
      lastMarkedRead.current = null;
    });
  }, [focused, tripId, newestConfirmed]);

  const deliver = async (local: LocalMessage) => {
    if (!tripId) return;
    try {
      const saved = await request(`/trips/${tripId}/messages`, {
        method: 'POST',
        body: { id: local.id, body: local.body },
        schema: ChatMessage,
      });
      setMessages((prev) => mergeMessages(prev ?? [], [saved]));
    } catch {
      setMessages((prev) => mergeMessages(prev ?? [], [{ ...local, status: 'failed' }]));
    }
  };

  const send = () => {
    const body = draft.trim();
    if (!body || !trip || !me) return;
    const mine = trip.members.find((m) => m.userId === me);
    const local: LocalMessage = {
      id: newId(),
      tripId: trip.id,
      senderId: me,
      senderName: mine?.displayName ?? null,
      kind: 'text',
      body,
      replyToId: null,
      payload: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      status: 'sending',
    };
    setDraft('');
    setMessages((prev) => mergeMessages(prev ?? [], [local]));
    void deliver(local);
  };

  const onChangeDraft = (text: string) => {
    setDraft(text);
    const now = Date.now();
    if (tripId && text.trim() && now - lastTypingSent.current > TYPING_SEND_EVERY_MS) {
      lastTypingSent.current = now;
      realtime.send({ op: 'typing', tripId });
    }
  };

  const react = async (message: LocalMessage, emoji: string) => {
    setActionsFor(null);
    const mine = message.reactions.some((r) => r.emoji === emoji && r.mine);
    setMessages(
      (prev) => prev?.map((m) => (m.id === message.id ? applyReaction(m, emoji, !mine, true) : m)) ?? prev,
    );
    try {
      const result = await request(`/messages/${message.id}/reactions`, {
        method: 'POST',
        body: { emoji },
      });
      const { reactions } = result as { reactions: LocalMessage['reactions'] };
      setMessages((prev) => prev?.map((m) => (m.id === message.id ? { ...m, reactions } : m)) ?? prev);
    } catch {
      void load();
    }
  };

  const memberIndex = useMemo(
    () => new Map((trip?.members ?? []).map((m, i) => [m.userId, i])),
    [trip?.members],
  );
  const rows = useMemo(() => buildRows(messages ?? []), [messages]);
  const myLatest = messages?.find((m) => m.senderId === me && m.kind === 'text' && !m.status);
  const typingNames = Object.values(typing).map((t) => t.name);

  if (!trip) return null;

  const renderRow = ({ item }: { item: ChatRow }) => {
    if (item.type === 'day') {
      return <Text style={styles.day}>{item.label}</Text>;
    }
    const m = item.message;
    if (m.kind === 'system') {
      return (
        <View style={styles.systemWrap}>
          <Text style={styles.system}>{m.body}</Text>
        </View>
      );
    }
    const mine = m.senderId === me;
    const seen = m.id === myLatest?.id ? seenCount(m, readStates, me!) : 0;
    return (
      <View style={[styles.row, mine && styles.rowMine, item.firstInGroup && { marginTop: space.md }]}>
        {!mine ? (
          <View style={{ width: 30 }}>
            {item.firstInGroup ? (
              <Avatar
                name={m.senderName ?? '?'}
                color={avatarColor(memberIndex.get(m.senderId ?? '') ?? 0)}
                size={28}
              />
            ) : null}
          </View>
        ) : null}
        <View style={[styles.bubbleCol, mine && { alignItems: 'flex-end' }]}>
          {!mine && item.firstInGroup ? <Text style={styles.sender}>{m.senderName}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${mine ? 'You' : m.senderName}: ${m.body}`}
            accessibilityHint={m.status === 'failed' ? 'Double tap to send again' : 'Long press for options'}
            onLongPress={() => setActionsFor(m)}
            onPress={() => (m.status === 'failed' ? void deliver({ ...m, status: 'sending' }) : undefined)}
            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, m.status === 'sending' && { opacity: 0.6 }]}
          >
            <Text style={[styles.body, mine && { color: '#FFFFFF' }]}>{m.body}</Text>
          </Pressable>
          {m.reactions.length > 0 ? (
            <View style={[styles.reactions, mine && { justifyContent: 'flex-end' }]}>
              {m.reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.emoji} ${r.count}`}
                  aria-selected={r.mine}
                  onPress={() => void react(m, r.emoji)}
                  style={[styles.reaction, r.mine && styles.reactionMine]}
                >
                  <Text style={styles.reactionText}>
                    {r.emoji} {r.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={[styles.meta, m.status === 'failed' && { color: colors.danger }]}>
            {m.status === 'sending'
              ? 'Sending…'
              : m.status === 'failed'
                ? "Didn't send. Tap to try again"
                : `${timeOf(m.createdAt)}${seen > 0 ? ` · Seen by ${seen}` : ''}`}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {trip.name}
        </Text>
        <Body style={{ fontSize: 13 }}>
          {trip.members.map((m) => (m.userId === me ? 'you' : m.displayName)).join(', ')}
        </Body>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {error ? (
          <View style={styles.center}>
            <Body>{error}</Body>
            <Button label="Try again" variant="outline" onPress={load} />
          </View>
        ) : !messages ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderRow}
            contentContainerStyle={styles.list}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.accent} /> : null}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather name="message-square" size={28} color={colors.accent} />
                <Body style={{ textAlign: 'center' }}>Say hi to the group.</Body>
              </View>
            }
          />
        )}

        <Text style={styles.typing} accessibilityLiveRegion="polite">
          {typingNames.length === 1
            ? `${typingNames[0]} is typing…`
            : typingNames.length > 1
              ? `${typingNames.join(', ')} are typing…`
              : ' '}
        </Text>

        {canPost ? (
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Message"
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Message the group"
              placeholderTextColor="#8C867B"
              multiline
              maxLength={4000}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              aria-disabled={!draft.trim()}
              onPress={send}
              style={[styles.send, !draft.trim() && { opacity: 0.4 }]}
            >
              <Feather name="send" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.viewerNote}>
            <Body style={{ fontSize: 13, textAlign: 'center' }}>Viewers can read the chat but not post.</Body>
          </View>
        )}
      </KeyboardAvoidingView>

      <MessageActions
        message={actionsFor}
        canReact={!!actionsFor && !actionsFor.status}
        canAddToPlan={canPost && actionsFor?.kind === 'text'}
        onReact={(emoji) => actionsFor && void react(actionsFor, emoji)}
        onAddToPlan={() => {
          const body = actionsFor?.body ?? '';
          setActionsFor(null);
          router.push({ pathname: '/trips/[id]/plan', params: { id: trip.id, draft: body.slice(0, 200) } });
        }}
        onCopy={() => {
          void Clipboard.setStringAsync(actionsFor?.body ?? '');
          setActionsFor(null);
        }}
        onClose={() => setActionsFor(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  list: { paddingHorizontal: space.lg, paddingVertical: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48, transform: [{ scaleY: -1 }] },
  day: { alignSelf: 'center', marginVertical: space.md, fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  systemWrap: { alignItems: 'center', marginVertical: space.sm },
  system: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, backgroundColor: '#EDE8DF', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', textAlign: 'center' },
  row: { flexDirection: 'row', gap: space.sm, marginTop: 3 },
  rowMine: { justifyContent: 'flex-end' },
  bubbleCol: { maxWidth: '78%', gap: 3 },
  sender: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 6 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  reaction: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  reactionMine: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  reactionText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginHorizontal: 4 },
  typing: { paddingHorizontal: space.xl, paddingVertical: 4, fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bg, paddingHorizontal: space.lg, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  viewerNote: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
