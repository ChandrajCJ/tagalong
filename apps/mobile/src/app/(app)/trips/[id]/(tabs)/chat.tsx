import Feather from '@expo/vector-icons/Feather';
import {
  guessAmount,
  ChatMessage,
  hasRole,
  insertMention,
  LinkPreview,
  MAX_CHAT_IMAGES,
  Me,
  mentionedIn,
  mentionQuery,
  MessagePage,
  messageTicks,
  newId,
  Poll,
  type Person,
  type Photo,
  type PollOption,
  type ReadState,
} from '@tagalong/shared';
import { z } from 'zod';
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
import { ActionMenu } from '@/components/action-menu';
import { ChatImageGrid, LinkPreviewCard, PendingImages } from '@/components/chat-images';
import { DayPicker } from '@/components/day-picker';
import { MessageActions } from '@/components/message-actions';
import { MessageBody } from '@/components/message-body';
import { MessageInfoSheet } from '@/components/message-info-sheet';
import { PhotoViewer } from '@/components/photo-viewer';
import { PollCard } from '@/components/poll-card';
import { PollComposer, type PollDraft } from '@/components/poll-composer';
import { Avatar, Body, Button } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { asViewerPhotos, imagesFromPaste, pickFromLibrary, takePhoto, type PickedImage } from '@/lib/chat-media';
import { CLIENT_ID } from '@/lib/client-id';
import { confirmAction } from '@/lib/confirm';
import { noteDelivered } from '@/lib/delivery';
import {
  applyDelete,
  applyEdit,
  applyReaction,
  buildRows,
  canEditMessage,
  mergeMessages,
  mergeReadState,
  timeOf,
  type ChatRow,
  type LocalMessage,
} from '@/lib/chat';
import { encodeDraft, type ExpenseDraft } from '@/lib/money';
import { uploadPhoto } from '@/lib/photos';
import { planDays } from '@/lib/plan';
import { realtime, useTripRealtime } from '@/lib/realtime';
import { secureStorage } from '@/lib/storage';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

/** What adding a poll option to the plan sends back. */
const PollPlanned = z.object({ poll: Poll });

/** Remembers that someone has seen how to reply and react. */
const HOLD_TIP_KEY = 'tagalong.tip.holdMessage';

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
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  // My own message being fixed: the composer holds its text until saved.
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  // A poll option on its way into the plan, waiting for "which day?".
  const [planning, setPlanning] = useState<{ message: LocalMessage; option: PollOption } | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  // A short message above the composer: "Copied", or what went wrong.
  const [flash, setFlash] = useState<string>();
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (text: string) => {
    setFlash(text);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(undefined), 2500);
  };
  // Holding a message is how to reply or react; say so until someone has done it once.
  const [showHoldTip, setShowHoldTip] = useState(false);
  useEffect(() => {
    void secureStorage.get(HOLD_TIP_KEY).then((seen) => setShowHoldTip(!seen));
  }, []);
  const openActions = (message: LocalMessage) => {
    setActionsFor(message);
    if (showHoldTip) {
      setShowHoldTip(false);
      void secureStorage.set(HOLD_TIP_KEY, '1');
    }
  };
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [askingPoll, setAskingPoll] = useState(false);
  const lastTypingSent = useRef(0);
  const lastMarkedRead = useRef<string | null>(null);
  // Photos picked for the next message, and whether they also go in the album.
  const [attachments, setAttachments] = useState<PickedImage[]>([]);
  const [alsoAlbum, setAlsoAlbum] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  // Photos of messages still sending: kept with their ids so a retry reuses the uploads.
  const uploads = useRef(new Map<string, { picked: PickedImage[]; ids: string[]; album: boolean }>());
  // The people picked from "@" while typing this message.
  const [mentionPeople, setMentionPeople] = useState<Person[]>([]);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ photos: Photo[]; startId: string } | null>(null);
  // With my read receipts off, I see nobody's reads either.
  const [readsShown, setReadsShown] = useState(true);
  useEffect(() => {
    void request('/me', { schema: Me })
      .then((m) => setReadsShown(m.readReceipts))
      .catch(() => undefined);
  }, []);

  const tripId = trip?.id;
  const me = trip?.myUserId;
  const canPost = !!trip && hasRole(trip.myRole, 'editor');
  const others = useMemo(
    () => (trip?.members ?? []).filter((m) => m.userId !== me).map((m) => ({ userId: m.userId, displayName: m.displayName })),
    [trip?.members, me],
  );
  const mentioning = canPost ? mentionQuery(draft) : null;
  const mentionMatches =
    mentioning === null ? [] : others.filter((p) => p.displayName.toLowerCase().startsWith(mentioning.toLowerCase())).slice(0, 6);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const page = await request(`/trips/${tripId}/messages`, { schema: MessagePage });
      // Keep anything still sending; the server copy replaces the rest.
      setMessages((prev) => mergeMessages((prev ?? []).filter((m) => m.status), page.messages));
      setCursor(page.nextCursor);
      setReadStates(page.readStates);
      setError(undefined);
      // Fetching counts as receiving, for anything that came in while offline.
      const newest = page.messages[0];
      if (newest) noteDelivered(tripId, newest);
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
      // Messages in a plan item's thread belong to that item's screen, not here.
      if (!parsed.success || parsed.data.itemId) return;
      setMessages((prev) => mergeMessages(prev ?? [], [parsed.data]));
      // Whoever sent it has stopped typing.
      if (parsed.data.senderId) {
        setTyping((prev) => {
          const next = { ...prev };
          delete next[parsed.data.senderId!];
          return next;
        });
      }
    } else if (event.type === 'message.updated') {
      const parsed = ChatMessage.safeParse(event.payload);
      if (!parsed.success || parsed.data.itemId) return;
      setMessages((prev) => (prev ? applyEdit(prev, parsed.data) : prev));
    } else if (event.type === 'message.deleted') {
      const p = event.payload as { messageId: string; itemId?: string | null };
      if (p.itemId) return;
      setMessages((prev) => (prev ? applyDelete(prev, p.messageId) : prev));
      // Someone (an owner) deleted the message I was editing.
      if (editing?.id === p.messageId) {
        setEditing(null);
        setDraft('');
      }
      if (replyingTo?.id === p.messageId) setReplyingTo(null);
    } else if (event.type === 'reaction.changed') {
      // A reaction is applied as +1/-1, so our own would count twice: we
      // already applied it when the button was tapped.
      if (event.originClientId === CLIENT_ID) return;
      const p = event.payload as { messageId: string; emoji: string; userId: string; added: boolean };
      setMessages(
        (prev) =>
          prev?.map((msg) =>
            msg.id === p.messageId ? applyReaction(msg, p.emoji, p.added, p.userId === me) : msg,
          ) ?? prev,
      );
    } else if (event.type === 'poll.voted' || event.type === 'poll.closed') {
      const p = event.payload as { messageId: string; poll: unknown };
      const parsed = Poll.safeParse(p.poll);
      if (!parsed.success) return;
      // The payload carries the sender's own picks, so work ours out again.
      const poll: Poll = {
        ...parsed.data,
        options: parsed.data.options.map((o) => ({
          ...o,
          mine: o.voters.some((v) => v.userId === me),
        })),
      };
      setMessages((prev) => prev?.map((msg) => (msg.id === p.messageId ? { ...msg, poll } : msg)) ?? prev);
    } else if (event.type === 'read.updated' || event.type === 'delivery.updated') {
      const p = event.payload as Partial<ReadState> & { userId: string; itemId?: string | null };
      if (p.itemId) return;
      // With my receipts off, others' read times aren't mine to see.
      const lastReadAt = readsShown || p.userId === me ? p.lastReadAt : null;
      setReadStates((prev) => mergeReadState(prev, { ...p, lastReadAt }));
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
    setMessages((prev) => mergeMessages(prev ?? [], [{ ...local, status: 'sending' }]));
    try {
      // Photos go up first, each to its own id, so trying again never sends one twice.
      const pending = uploads.current.get(local.id);
      if (pending) {
        await Promise.all(
          pending.picked.map((asset, i) => uploadPhoto(tripId, asset, pending.album ? 'album' : 'chat', { id: pending.ids[i] })),
        );
      }
      const mentions = (local.payload as { mentions?: string[] } | null)?.mentions ?? [];
      const saved = await request(`/trips/${tripId}/messages`, {
        method: 'POST',
        body: {
          id: local.id,
          body: local.body,
          ...(local.replyToId ? { replyToId: local.replyToId } : {}),
          ...(pending ? { mediaIds: pending.ids } : {}),
          ...(mentions.length > 0 ? { mentions } : {}),
        },
        schema: ChatMessage,
      });
      uploads.current.delete(local.id);
      setMessages((prev) => mergeMessages(prev ?? [], [saved]));
    } catch {
      setMessages((prev) => mergeMessages(prev ?? [], [{ ...local, status: 'failed' }]));
    }
  };

  const attach = async (how: 'library' | 'camera') => {
    const room = MAX_CHAT_IMAGES - attachments.length;
    if (room <= 0) return say(`A message can carry up to ${MAX_CHAT_IMAGES} photos`);
    const picked = how === 'library' ? await pickFromLibrary(room) : await takePhoto();
    if (typeof picked === 'string') return say(picked);
    setAttachments((prev) => [...prev, ...picked].slice(0, MAX_CHAT_IMAGES));
  };

  // In the browser, a pasted screenshot is attached like a picked photo.
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused || !canPost) return;
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.types.includes('Files')) return;
      e.preventDefault();
      void imagesFromPaste(e).then((images) => setAttachments((prev) => [...prev, ...images].slice(0, MAX_CHAT_IMAGES)));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [focused, canPost]);

  const addToAlbum = async (message: LocalMessage) => {
    setActionsFor(null);
    const missing = message.images.filter((i) => !i.inAlbum);
    try {
      await Promise.all(missing.map((i) => request(`/photos/${i.id}/album`, { method: 'POST' })));
      setMessages(
        (prev) =>
          prev?.map((m) => (m.id === message.id ? { ...m, images: m.images.map((i) => ({ ...i, inAlbum: true })) } : m)) ?? prev,
      );
      say(missing.length === 1 ? 'Added to the album' : `Added ${missing.length} photos to the album`);
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Couldn’t add them to the album. Try again.');
    }
  };

  /** Who wrote the message a reply quotes: "You", their name, or the app for activity cards. */
  const quotedName = (name: string | null) => {
    if (name === null) return 'Tagalong';
    return name === trip?.members.find((x) => x.userId === me)?.displayName ? 'You' : name;
  };

  /** Saves an edit: shown straight away, put back if the server says no. */
  const saveEdit = async (message: LocalMessage, body: string) => {
    setEditing(null);
    setDraft('');
    if (body === message.body) return;
    setMessages((prev) => (prev ? applyEdit(prev, { ...message, body, editedAt: new Date().toISOString() }) : prev));
    try {
      const mentions = mentionedIn(body, mentionPeople);
      const saved = await request(`/messages/${message.id}`, { method: 'PATCH', body: { body, mentions }, schema: ChatMessage });
      setMessages((prev) => (prev ? applyEdit(prev, saved) : prev));
    } catch (e) {
      setMessages((prev) => (prev ? applyEdit(prev, message) : prev));
      say(e instanceof ApiError ? e.message : 'Couldn’t save your edit. Try again.');
    }
  };

  const deleteMessage = async (message: LocalMessage) => {
    setActionsFor(null);
    const theirs = message.senderId !== me;
    const ok = await confirmAction(
      'Delete this message?',
      theirs
        ? `${message.senderName ?? 'Their'}’s message is removed for everyone in the chat.`
        : 'It’s removed for everyone in the chat.',
      'Delete',
    );
    if (!ok) return;
    try {
      await request(`/messages/${message.id}`, { method: 'DELETE' });
      setMessages((prev) => (prev ? applyDelete(prev, message.id) : prev));
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Couldn’t delete that message. Try again.');
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
    setMentionPeople([]);
  };

  const send = () => {
    const body = draft.trim();
    if (editing) {
      if (body) void saveEdit(editing, body);
      setMentionPeople([]);
      return;
    }
    if ((!body && attachments.length === 0) || !trip || !me) return;
    const mine = trip.members.find((m) => m.userId === me);
    const mentions = mentionedIn(body, mentionPeople);
    const id = newId();
    if (attachments.length > 0) {
      uploads.current.set(id, { picked: attachments, ids: attachments.map(() => newId()), album: alsoAlbum });
    }
    const local: LocalMessage = {
      id,
      tripId: trip.id,
      senderId: me,
      senderName: mine?.displayName ?? null,
      kind: attachments.length > 0 ? 'image' : 'text',
      body,
      replyToId: replyingTo?.id ?? null,
      replyTo: replyingTo
        ? { id: replyingTo.id, senderName: replyingTo.senderName, body: replyingTo.body.slice(0, 140), deleted: false }
        : null,
      payload: mentions.length > 0 ? { mentions } : null,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      reactions: [],
      poll: null,
      images: [],
      itemId: null,
      status: 'sending',
      localUris: attachments.map((a) => ({ uri: a.uri, video: a.type === 'video' })),
    };
    setDraft('');
    setReplyingTo(null);
    setAttachments([]);
    setAlsoAlbum(false);
    setMentionPeople([]);
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
      say('Couldn’t add that reaction. Try again.');
      void load();
    }
  };

  const setPoll = (messageId: string, poll: Poll) =>
    setMessages((prev) => prev?.map((m) => (m.id === messageId ? { ...m, poll } : m)) ?? prev);

  const askPoll = async (poll: PollDraft): Promise<string | null> => {
    if (!tripId) return 'Trip not loaded';
    try {
      const saved = await request(`/trips/${tripId}/polls`, {
        method: 'POST',
        body: { id: newId(), ...poll },
        schema: ChatMessage,
      });
      setMessages((prev) => mergeMessages(prev ?? [], [saved]));
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Could not ask that';
    }
  };

  /** Tapping an option adds it, or takes it back if it was already yours. */
  const votePoll = async (message: LocalMessage, optionId: string) => {
    const poll = message.poll;
    if (!poll) return;
    const picked = poll.options.find((o) => o.id === optionId);
    const optionIds = !picked?.mine
      ? poll.multi
        ? [...poll.options.filter((o) => o.mine).map((o) => o.id), optionId]
        : [optionId]
      : poll.options.filter((o) => o.mine && o.id !== optionId).map((o) => o.id);

    // Move the bars straight away, then confirm with the server.
    const optimistic: Poll = {
      ...poll,
      options: poll.options.map((o) => {
        const mine = optionIds.includes(o.id);
        return { ...o, mine, votes: o.votes + (mine ? 1 : 0) - (o.mine ? 1 : 0) };
      }),
      voterCount: poll.voterCount + (optionIds.length > 0 ? 1 : 0) - (poll.options.some((o) => o.mine) ? 1 : 0),
    };
    setPoll(message.id, optimistic);

    try {
      setPoll(message.id, await request(`/polls/${poll.id}/vote`, { method: 'POST', body: { optionIds }, schema: Poll }));
    } catch {
      setPoll(message.id, poll);
      say('Your vote didn’t go through. Try again.');
      void load();
    }
  };

  const closePoll = async (message: LocalMessage) => {
    if (!message.poll) return;
    try {
      setPoll(message.id, await request(`/polls/${message.poll.id}/close`, { method: 'POST', schema: Poll }));
    } catch {
      say('Couldn’t end the voting. Try again.');
      void load();
    }
  };

  const addOptionToPlan = async (date: string | null) => {
    if (!planning?.message.poll) return;
    const { message, option } = planning;
    setPlanningBusy(true);
    try {
      const result = await request(`/polls/${message.poll!.id}/options/${option.id}/plan`, {
        method: 'POST',
        body: { date },
        schema: PollPlanned,
      });
      setPoll(message.id, result.poll);
      say(`Added “${option.label}” to the plan`);
      setPlanning(null);
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Couldn’t add it to the plan. Try again.');
    } finally {
      setPlanningBusy(false);
    }
  };

  const memberIndex = useMemo(
    () => new Map((trip?.members ?? []).map((m, i) => [m.userId, i])),
    [trip?.members],
  );
  const rows = useMemo(() => buildRows(messages ?? []), [messages]);
  const tickMembers = useMemo(
    () => (trip?.members ?? []).map((m) => ({ userId: m.userId, joinedAt: m.joinedAt })),
    [trip?.members],
  );
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
    if (m.deletedAt) {
      const mine = m.senderId === me;
      return (
        <View style={[styles.row, mine && styles.rowMine, item.firstInGroup && { marginTop: space.md }]}>
          {!mine ? (
            <View style={{ width: 30 }}>
              {item.firstInGroup ? (
                <Avatar name={m.senderName ?? '?'} color={avatarColor(memberIndex.get(m.senderId ?? '') ?? 0)} size={28} />
              ) : null}
            </View>
          ) : null}
          <View style={[styles.bubbleCol, mine && { alignItems: 'flex-end' }]}>
            {!mine && item.firstInGroup ? <Text style={styles.sender}>{m.senderName}</Text> : null}
            <View style={[styles.bubble, styles.bubbleDeleted]}>
              <Feather name="slash" size={13} color={colors.muted} />
              <Text style={styles.deletedText}>{mine ? 'You deleted this message' : 'Message deleted'}</Text>
            </View>
            <Text style={styles.meta}>{timeOf(m.createdAt)}</Text>
          </View>
        </View>
      );
    }
    if (m.kind === 'poll' && m.poll) {
      return (
        <View style={[styles.row, m.senderId === me && styles.rowMine, { marginTop: space.md }]}>
          <View style={styles.pollCol}>
            <Text style={styles.sender}>
              {m.senderId === me ? 'You asked' : `${m.senderName} asked`}
            </Text>
            <PollCard
              poll={m.poll}
              memberCount={trip.members.length}
              canClose={m.senderId === me}
              onPick={(optionId) => void votePoll(m, optionId)}
              onClose={() => void closePoll(m)}
              canAddToPlan={canPost}
              onAddToPlan={(option) => setPlanning({ message: m, option })}
              onOpenItem={(itemId) => router.push(`/trips/${trip.id}/items/${itemId}`)}
            />
            <Text style={styles.meta}>{timeOf(m.createdAt)}</Text>
          </View>
        </View>
      );
    }
    const mine = m.senderId === me;
    const ticks = mine && !m.status ? messageTicks(m, tickMembers, readStates, readsShown) : null;
    const mentionIds = (m.payload as { mentions?: string[] } | null)?.mentions ?? [];
    const mentioned = trip.members.filter((p) => mentionIds.includes(p.userId));
    const parsedPreview = LinkPreview.safeParse((m.payload as { preview?: unknown } | null)?.preview);
    // Invites to this app need no card: the message already says what they are.
    const preview = parsedPreview.success && !parsedPreview.data.url.includes('/invite/') ? parsedPreview.data : null;
    const hasPhotos = m.images.length > 0 || (m.localUris?.length ?? 0) > 0;
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
            accessibilityLabel={`${mine ? 'You' : m.senderName}: ${hasPhotos ? `${m.images.length || m.localUris?.length} photos. ` : ''}${m.body}`}
            accessibilityHint={m.status === 'failed' ? 'Double tap to send again' : 'Long press for options'}
            onLongPress={() => openActions(m)}
            onPress={() => (m.status === 'failed' ? void deliver({ ...m, status: 'sending' }) : undefined)}
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              hasPhotos && styles.bubblePhotos,
              m.status === 'sending' && { opacity: 0.6 },
            ]}
          >
            {m.replyTo ? (
              <View style={[styles.quote, mine && styles.quoteMine]}>
                <Text style={[styles.quoteName, mine && { color: colors.onFill }]} numberOfLines={1}>
                  {quotedName(m.replyTo.senderName)}
                </Text>
                <Text style={[styles.quoteBody, mine && { color: colors.onAccentMuted }]} numberOfLines={2}>
                  {m.replyTo.deleted ? 'Original message deleted' : m.replyTo.body}
                </Text>
              </View>
            ) : null}
            {m.images.length > 0 ? (
              <ChatImageGrid images={m.images} onOpen={(startId) => setViewing({ photos: asViewerPhotos(m), startId })} />
            ) : m.localUris?.length ? (
              <PendingImages items={m.localUris} />
            ) : null}
            {m.body ? (
              <MessageBody
                text={m.body}
                mentioned={mentioned}
                me={me}
                onAccent={mine}
                style={{ ...styles.body, ...(mine ? { color: colors.onFill } : null), ...(hasPhotos ? { marginTop: 6, maxWidth: 220 } : null) }}
              />
            ) : null}
            {preview ? <LinkPreviewCard preview={preview} mine={mine} /> : null}
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
          <View style={[styles.metaRow, mine && { justifyContent: 'flex-end' }]}>
            <Text style={[styles.meta, m.status === 'failed' && { color: colors.danger }]}>
              {m.status === 'sending'
                ? hasPhotos
                  ? 'Sending photos…'
                  : 'Sending…'
                : m.status === 'failed'
                  ? "Didn't send. Tap to try again"
                  : `${timeOf(m.createdAt)}${m.editedAt ? ' · edited' : ''}`}
            </Text>
            {ticks ? <Ticks state={ticks} /> : null}
          </View>
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
        // Android draws edge to edge now, so the window no longer shrinks for
        // the keyboard: lift the composer with padding there too.
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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
                <Body style={{ textAlign: 'center' }}>
                  Say hi to the group. Later, hold any message to reply, react, or turn it into a plan item or
                  an expense.
                </Body>
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

        {flash ? (
          <View style={styles.flash} accessibilityLiveRegion="polite">
            <Text style={styles.flashText}>{flash}</Text>
          </View>
        ) : null}

        {canPost && showHoldTip && (messages?.length ?? 0) > 0 && !replyingTo && !editing ? (
          <View style={styles.tip}>
            <Feather name="info" size={14} color={colors.accentInk} />
            <Text style={styles.tipText}>Hold any message to reply, react, or add it to the plan or expenses.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hide tip"
              onPress={() => {
                setShowHoldTip(false);
                void secureStorage.set(HOLD_TIP_KEY, '1');
              }}
              style={styles.tipClose}
            >
              <Feather name="x" size={14} color={colors.accentInk} />
            </Pressable>
          </View>
        ) : null}

        {canPost && editing ? (
          <View style={styles.replyBar} accessibilityLiveRegion="polite">
            <View style={styles.replyAccent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyLabel} numberOfLines={1}>
                Editing message
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {editing.body}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={cancelEdit}
              style={styles.replyClose}
            >
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        {canPost && replyingTo && !editing ? (
          <View style={styles.replyBar} accessibilityLiveRegion="polite">
            <View style={styles.replyAccent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyLabel} numberOfLines={1}>
                Replying to {replyingTo.senderId === me ? 'yourself' : (replyingTo.senderName ?? 'Tagalong')}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {replyingTo.body}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              onPress={() => setReplyingTo(null)}
              style={styles.replyClose}
            >
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        {canPost && mentionMatches.length > 0 ? (
          <View style={styles.mentions} accessibilityLabel="People to mention">
            {mentionMatches.map((p) => (
              <Pressable
                key={p.userId}
                accessibilityRole="button"
                accessibilityLabel={`Mention ${p.displayName}`}
                onPress={() => {
                  setDraft((d) => insertMention(d, p.displayName));
                  setMentionPeople((prev) => (prev.some((x) => x.userId === p.userId) ? prev : [...prev, p]));
                  inputRef.current?.focus();
                }}
                style={styles.mentionRow}
              >
                <Avatar name={p.displayName} color={avatarColor(memberIndex.get(p.userId) ?? 0)} size={26} />
                <Text style={styles.mentionName}>{p.displayName}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {canPost && attachments.length > 0 && !editing ? (
          <View style={styles.attachments}>
            <View style={styles.attachRow}>
              {attachments.map((a) => (
                <View key={a.key}>
                  <PendingImages items={[{ uri: a.uri, video: a.type === 'video' }]} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove this photo"
                    onPress={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))}
                    style={styles.attachRemove}
                  >
                    <Feather name="x" size={14} color={colors.onFill} />
                  </Pressable>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="checkbox"
              aria-checked={alsoAlbum}
              onPress={() => setAlsoAlbum((v) => !v)}
              style={styles.albumToggle}
            >
              <Feather name={alsoAlbum ? 'check-square' : 'square'} size={18} color={colors.accent} />
              <Text style={styles.albumToggleText}>Also add to the trip album</Text>
            </Pressable>
          </View>
        ) : null}

        {canPost ? (
          <View style={styles.composer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a poll"
              onPress={() => setAskingPoll(true)}
              style={styles.pollButton}
            >
              <Feather name="bar-chart-2" size={18} color={colors.accent} />
              <Text style={styles.pollText}>Poll</Text>
            </Pressable>
            {!editing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add photos"
                onPress={() => setAttachMenu(true)}
                style={styles.attachButton}
              >
                <Feather name="paperclip" size={18} color={colors.accent} />
              </Pressable>
            ) : null}
            <TextInput
              ref={inputRef}
              accessibilityLabel="Message"
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={attachments.length > 0 ? 'Add a caption' : 'Message the group'}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={4000}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Save edit' : 'Send'}
              aria-disabled={!draft.trim() && attachments.length === 0}
              onPress={send}
              style={[styles.send, !draft.trim() && attachments.length === 0 && { opacity: 0.4 }]}
            >
              <Feather name={editing ? 'check' : 'send'} size={20} color={colors.onFill} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.viewerNote}>
            <Body style={{ fontSize: 13, textAlign: 'center' }}>Viewers can read the chat but not post.</Body>
          </View>
        )}
      </KeyboardAvoidingView>

      <DayPicker
        visible={!!planning}
        title="Which day?"
        subtitle={planning ? `Put “${planning.option.label}” on the plan` : undefined}
        days={trip.startDate ? planDays(trip.startDate, trip.endDate, []) : []}
        busy={planningBusy}
        onPick={(date) => void addOptionToPlan(date)}
        onClose={() => setPlanning(null)}
      />

      <PollComposer visible={askingPoll} onAsk={askPoll} onClose={() => setAskingPoll(false)} />

      <MessageActions
        message={actionsFor}
        canReact={!!actionsFor && !actionsFor.status}
        canAddToPlan={canPost && actionsFor?.kind === 'text'}
        canReply={canPost && !!actionsFor && actionsFor.kind !== 'system' && !actionsFor.status}
        canEdit={canPost && !!actionsFor && canEditMessage(actionsFor, me)}
        canDelete={
          !!actionsFor &&
          !actionsFor.status &&
          actionsFor.kind !== 'system' &&
          (actionsFor.senderId === me || trip.myRole === 'owner')
        }
        canInfo={!!actionsFor && actionsFor.senderId === me && !actionsFor.status && actionsFor.kind !== 'system'}
        canAddToAlbum={canPost && !!actionsFor && actionsFor.images.some((i) => !i.inAlbum)}
        onInfo={() => {
          setInfoFor(actionsFor?.id ?? null);
          setActionsFor(null);
        }}
        onAddToAlbum={() => actionsFor && void addToAlbum(actionsFor)}
        onEdit={() => {
          const message = actionsFor;
          setActionsFor(null);
          if (!message) return;
          setReplyingTo(null);
          setEditing(message);
          setDraft(message.body);
          const ids = (message.payload as { mentions?: string[] } | null)?.mentions ?? [];
          setMentionPeople(others.filter((p) => ids.includes(p.userId)));
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        onDelete={() => actionsFor && void deleteMessage(actionsFor)}
        onReply={() => {
          if (editing) cancelEdit();
          setReplyingTo(actionsFor);
          setActionsFor(null);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        onReact={(emoji) => actionsFor && void react(actionsFor, emoji)}
        onAddToPlan={() => {
          const body = actionsFor?.body ?? '';
          setActionsFor(null);
          router.push({ pathname: '/trips/[id]/plan', params: { id: trip.id, draft: body.slice(0, 200) } });
        }}
        onAddExpense={() => {
          const message = actionsFor;
          setActionsFor(null);
          if (!message) return;
          const amountMinor = guessAmount(message.body, trip.baseCurrency);
          const draft: ExpenseDraft = {
            description: message.body.slice(0, 120),
            ...(amountMinor ? { amountMinor } : {}),
            sourceMessageId: message.id,
          };
          router.push({ pathname: '/trips/[id]/money', params: { id: trip.id, expense: encodeDraft(draft) } });
        }}
        onCopy={() => {
          void Clipboard.setStringAsync(actionsFor?.body ?? '');
          say('Copied');
          setActionsFor(null);
        }}
        onClose={() => setActionsFor(null)}
      />

      <ActionMenu
        visible={attachMenu}
        title="Add photos"
        onClose={() => setAttachMenu(false)}
        actions={[
          { icon: 'image', label: 'Photos and videos', hint: `Up to ${MAX_CHAT_IMAGES}; videos up to a minute`, onPress: () => void attach('library') },
          ...(Platform.OS !== 'web'
            ? [{ icon: 'camera' as const, label: 'Camera', hint: 'Take one now', onPress: () => void attach('camera') }]
            : [{ icon: 'clipboard' as const, label: 'Paste a screenshot', hint: 'Copy it, then press Ctrl+V or ⌘V in the chat', onPress: () => say('Press Ctrl+V or ⌘V to paste') }]),
        ]}
      />
      <MessageInfoSheet messageId={infoFor} onClose={() => setInfoFor(null)} />
      <PhotoViewer
        photos={viewing?.photos ?? []}
        startId={viewing?.startId ?? null}
        canDelete={() => false}
        onDelete={async () => undefined}
        onClose={() => setViewing(null)}
      />
    </SafeAreaView>
  );
}

/** ✓ sent, ✓✓ delivered to everyone, ✓✓ in the accent colour once everyone has read it. */
function Ticks({ state }: { state: 'sent' | 'delivered' | 'read' }) {
  const color = state === 'read' ? colors.accent : colors.muted;
  const label = state === 'read' ? 'Read by everyone' : state === 'delivered' ? 'Delivered to everyone' : 'Sent';
  return (
    <View accessibilityLabel={label} accessible style={{ flexDirection: 'row', width: state === 'sent' ? 14 : 20 }}>
      <Feather name="check" size={14} color={color} />
      {state !== 'sent' ? <Feather name="check" size={14} color={color} style={{ marginLeft: -8 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentWash, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  quoteMine: { borderLeftColor: colors.onFill, backgroundColor: colors.onFillWash },
  quoteName: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
  quoteBody: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.md, paddingLeft: space.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  replyAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.accent },
  replyLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.accent },
  replyText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  replyClose: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  list: { paddingHorizontal: space.lg, paddingVertical: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48, transform: [{ scaleY: -1 }] },
  day: { alignSelf: 'center', marginVertical: space.md, fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  systemWrap: { alignItems: 'center', marginVertical: space.sm },
  system: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, backgroundColor: colors.track, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden', textAlign: 'center' },
  row: { flexDirection: 'row', gap: space.sm, marginTop: 3 },
  rowMine: { justifyContent: 'flex-end' },
  bubbleCol: { maxWidth: '78%', gap: 3 },
  pollCol: { maxWidth: '86%', gap: 3 },
  bubblePhotos: { padding: 4, paddingBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  attachButton: { width: 40, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  attachments: { marginHorizontal: space.md, marginBottom: space.xs, padding: space.sm, gap: space.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  attachRemove: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  albumToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  albumToggleText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  mentions: { marginHorizontal: space.md, marginBottom: space.xs, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md },
  mentionName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  pollButton: { flexDirection: 'row', gap: 4, height: 44, paddingHorizontal: 10, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  pollText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  flash: { alignSelf: 'center', marginBottom: space.xs, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.ink },
  flashText: { fontFamily: fonts.bold, fontSize: 13, color: colors.onFill },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.md, marginBottom: space.xs, paddingLeft: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  tipText: { flex: 1, fontFamily: fonts.medium, fontSize: 12, color: colors.accentInk, paddingVertical: 8 },
  tipClose: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  sender: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  bubbleDeleted: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, backgroundColor: 'transparent' },
  deletedText: { fontFamily: fonts.body, fontStyle: 'italic', fontSize: 14, color: colors.muted },
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
