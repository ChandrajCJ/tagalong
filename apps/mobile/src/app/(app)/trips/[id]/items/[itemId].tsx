import Feather from '@expo/vector-icons/Feather';
import {
  Booking,
  BookingList,
  ChatMessage,
  DocumentList,
  FavouriteResult,
  hasRole,
  ItineraryItem,
  MessagePage,
  newId,
  PhotoList,
  type Photo,
  type BookingType,
  type ItemType,
  type TripDocument,
} from '@tagalong/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookingCard } from '@/components/booking-card';
import { titleOf } from '@/lib/bookings';
import { categoryFor, encodeDraft, type ExpenseDraft } from '@/lib/money';
import {
  BookingSheet,
  type BookingFields,
  type SaveResult as BookingSaveResult,
} from '@/components/booking-sheet';
import {
  ItemSheet,
  type ItemFields,
  type SaveResult as ItemSaveResult,
} from '@/components/item-sheet';
import { PhotoViewer } from '@/components/photo-viewer';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { mergeMessages, timeOf, type LocalMessage } from '@/lib/chat';
import { documentUrl, fileSize, typeLabel } from '@/lib/documents';
import { dayKeyOf, formatCost, ITEM_TYPE_META, planDays, shortDate } from '@/lib/plan';
import { realtime, useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

/** A plan item's own type is a good first guess at what its booking is. */
const BOOKING_FOR_ITEM: Record<ItemType, BookingType> = {
  flight: 'flight',
  stay: 'stay',
  transport: 'train',
  meal: 'restaurant',
  activity: 'ticket',
  other: 'ticket',
};

/**
 * Everything about one plan item in one place (design: ItemDetail.dc.html):
 * the booking, its confirmation file, the cost, and a thread of its own so a
 * debate about one restaurant stays with that restaurant.
 */
export default function ItemDetail() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { trip } = useTrip();
  const [item, setItem] = useState<ItineraryItem | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [docs, setDocs] = useState<TripDocument[]>([]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [bookingSheet, setBookingSheet] = useState<{ open: boolean; booking?: Booking }>({
    open: false,
  });
  const [draft, setDraft] = useState('');
  // Photos taken during this item, matched by time on the server.
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const tripId = trip?.id;
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');

  const load = useCallback(async () => {
    if (!tripId || !itemId) return;
    try {
      const [loaded, bookingList, docList, thread, taken] = await Promise.all([
        request(`/items/${itemId}`, { schema: ItineraryItem }),
        request(`/trips/${tripId}/bookings`, { schema: BookingList }),
        request(`/trips/${tripId}/documents`, { schema: DocumentList }),
        request(`/items/${itemId}/messages`, { schema: MessagePage }),
        request(`/items/${itemId}/photos`, { schema: PhotoList }),
      ]);
      setPhotos(taken.photos);
      setItem(loaded);
      setBookings(bookingList.bookings);
      setDocs(docList.documents.filter((d) => d.status === 'ready'));
      // Keep anything still sending; the server's copy replaces the rest.
      setMessages((prev) =>
        mergeMessages(
          prev.filter((m) => m.status),
          thread.messages,
        ),
      );
      setCursor(thread.nextCursor);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this item');
    }
  }, [tripId, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPhotos = useCallback(async () => {
    if (!itemId) return;
    const taken = await request(`/items/${itemId}/photos`, { schema: PhotoList }).catch(() => null);
    if (taken) setPhotos(taken.photos);
  }, [itemId]);

  useTripRealtime(tripId, (m) => {
    if (m.kind === 'reconnected') return void load();
    if (m.kind === 'error' && m.code === 'removed') return router.replace('/trips');
    if (m.kind !== 'event') return;
    const { event } = m;

    if (event.type === 'item.upserted' && event.entityId === itemId) {
      const parsed = ItineraryItem.safeParse(event.payload);
      if (parsed.success)
        setItem((cur) => (cur && cur.version > parsed.data.version ? cur : parsed.data));
      // New times can mean different photos.
      void loadPhotos();
    } else if (event.type.startsWith('photo.')) {
      void loadPhotos();
    } else if (event.type === 'item.deleted' && event.entityId === itemId) {
      router.back();
    } else if (event.type === 'booking.upserted') {
      const parsed = Booking.safeParse(event.payload);
      if (!parsed.success) return;
      setBookings((prev) => {
        const i = prev.findIndex((b) => b.id === parsed.data.id);
        if (i === -1) return [...prev, parsed.data];
        if (prev[i]!.version > parsed.data.version) return prev;
        return prev.map((b) => (b.id === parsed.data.id ? parsed.data : b));
      });
    } else if (event.type === 'booking.deleted') {
      setBookings((prev) => prev.filter((b) => b.id !== event.entityId));
    } else if (event.type === 'document.upserted' || event.type === 'document.deleted') {
      void load();
    } else if (event.type === 'message.created') {
      const parsed = ChatMessage.safeParse(event.payload);
      // Only this item's thread; the main chat and other threads aren't ours.
      if (parsed.success && parsed.data.itemId === itemId) {
        setMessages((prev) => mergeMessages(prev, [parsed.data]));
      }
    }
  });

  const mine = useMemo(() => bookings.filter((b) => b.itemId === itemId), [bookings, itemId]);
  const days = useMemo(
    () => (trip && item ? planDays(trip.startDate, trip.endDate, [item]) : []),
    [trip, item],
  );
  const memberIndex = useMemo(
    () => new Map((trip?.members ?? []).map((m, i) => [m.userId, i])),
    [trip?.members],
  );

  if (error) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Body>{error}</Body>
        <Button label="Try again" variant="outline" onPress={load} />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!trip || !item) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const openEdit = () => {
    setEditing(true);
    realtime.send({ op: 'editing', tripId: trip.id, itemId: item.id });
  };
  const closeEdit = () => {
    setEditing(false);
    realtime.send({ op: 'editing', tripId: trip.id, itemId: null });
  };

  const saveItem = async (fields: ItemFields): Promise<ItemSaveResult> => {
    try {
      setItem(
        await request(`/items/${item.id}`, {
          method: 'PATCH',
          body: { ...fields, version: item.version },
          schema: ItineraryItem,
        }),
      );
      return { ok: true };
    } catch (e) {
      const latest =
        e instanceof ApiError && e.status === 409 && ItineraryItem.safeParse(e.data.current);
      if (latest && latest.success) {
        setItem(latest.data);
        return { conflict: latest.data };
      }
      return { error: e instanceof ApiError ? e.message : 'Could not save that' };
    }
  };

  const deleteItem = async () => {
    await request(`/items/${item.id}`, { method: 'DELETE' }).catch(() => {});
    router.back();
  };

  const saveBooking = async (fields: BookingFields): Promise<BookingSaveResult> => {
    const existing = bookingSheet.booking;
    try {
      const saved = existing
        ? await request(`/bookings/${existing.id}`, {
            method: 'PATCH',
            body: { ...fields, version: existing.version },
            schema: Booking,
          })
        : await request(`/trips/${trip.id}/bookings`, {
            method: 'POST',
            body: { ...fields, id: newId(), itemId: item.id },
            schema: Booking,
          });
      setBookings((prev) => [...prev.filter((b) => b.id !== saved.id), saved]);
      return { ok: true };
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && Booking.safeParse(e.data.current);
      if (latest && latest.success) {
        setBookings((prev) => prev.map((b) => (b.id === latest.data.id ? latest.data : b)));
        setBookingSheet({ open: true, booking: latest.data });
        return { conflict: latest.data };
      }
      return { error: e instanceof ApiError ? e.message : 'Could not save the booking' };
    }
  };

  const deleteBooking = async () => {
    const existing = bookingSheet.booking;
    if (!existing) return;
    setBookings((prev) => prev.filter((b) => b.id !== existing.id));
    await request(`/bookings/${existing.id}`, { method: 'DELETE' }).catch(() => void load());
  };

  const favourite = async (photo: Photo) => {
    const on = !photo.favourited;
    const set = (favourites: number, favourited: boolean) =>
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, favourites, favourited } : p)),
      );
    set(photo.favourites + (on ? 1 : -1), on);
    try {
      const saved = await request(`/photos/${photo.id}/favourite`, {
        method: on ? 'PUT' : 'DELETE',
        schema: FavouriteResult,
      });
      set(saved.favourites, saved.favourited);
    } catch {
      set(photo.favourites, photo.favourited);
    }
  };

  const openDoc = async (doc: TripDocument) => {
    const { url } = await documentUrl(doc.id);
    await Linking.openURL(url);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    const me = trip.members.find((m) => m.userId === trip.myUserId);
    const local: LocalMessage = {
      id: newId(),
      tripId: trip.id,
      senderId: trip.myUserId,
      senderName: me?.displayName ?? null,
      kind: 'text',
      body,
      replyToId: null,
      payload: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      poll: null,
      itemId: item.id,
      status: 'sending',
    };
    setDraft('');
    setMessages((prev) => mergeMessages(prev, [local]));
    try {
      const saved = await request(`/items/${item.id}/messages`, {
        method: 'POST',
        body: { id: local.id, body },
        schema: ChatMessage,
      });
      setMessages((prev) => mergeMessages(prev, [saved]));
    } catch {
      setMessages((prev) => mergeMessages(prev, [{ ...local, status: 'failed' }]));
    }
  };

  const loadOlder = async () => {
    if (!cursor) return;
    const page = await request(`/items/${item.id}/messages?before=${encodeURIComponent(cursor)}`, {
      schema: MessagePage,
    });
    setMessages((prev) => mergeMessages(prev, page.messages));
    setCursor(page.nextCursor);
  };

  const meta = ITEM_TYPE_META[item.type];
  const when = [
    dayKeyOf(item) === 'anytime' ? 'Anytime' : shortDate(item.date!),
    item.startTime
      ? item.endTime
        ? `${item.startTime}–${item.endTime}${item.endTime <= item.startTime ? ' (next day)' : ''}`
        : item.startTime
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Oldest first, reading down, like any conversation.
  const thread = [...messages].reverse();
  const addExpense = (draft: ExpenseDraft) =>
    router.push({ pathname: '/trips/[id]/money', params: { id: trip.id, expense: encodeDraft(draft) } });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        {canEdit ? (
          <Pressable accessibilityRole="button" onPress={openEdit} style={styles.editButton}>
            <Feather name="edit-2" size={14} color={colors.accent} />
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm }}>
            <View style={styles.typeRow}>
              <Feather name={meta.icon} size={14} color={colors.accent} />
              <Text style={styles.typeText}>{meta.label}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {item.title}
            </Text>
            <Body>{when}</Body>
            {item.placeName ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={14} color={colors.muted} />
                <Body style={{ flex: 1 }}>{item.placeName}</Body>
              </View>
            ) : null}
            {item.costEstimateMinor != null && item.costCurrency ? (
              <View style={styles.metaRow}>
                <Feather name="credit-card" size={14} color={colors.muted} />
                <Body style={{ flex: 1 }}>About {formatCost(item.costEstimateMinor, item.costCurrency)} each</Body>
                {canEdit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add as an expense"
                    onPress={() =>
                      addExpense({
                        description: item.title,
                        // The plan's cost is per person, so the bill is that for everyone.
                        amountMinor: item.costEstimateMinor! * trip.members.length,
                        currency: item.costCurrency!,
                        spentOn: item.date ?? undefined,
                        category: categoryFor(item.type),
                        itemId: item.id,
                      })
                    }
                    style={styles.expenseLink}
                  >
                    <Text style={styles.expenseLinkText}>Add as expense</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {item.notes ? <Body style={styles.notes}>{item.notes}</Body> : null}
          </View>

          <View style={{ gap: space.md }}>
            <Label>{mine.length > 1 ? 'Bookings' : 'Booking'}</Label>
            {mine.map((b) => {
              const doc = docs.find((d) => d.id === b.documentId);
              return (
                <View key={b.id} style={{ gap: space.sm }}>
                  <BookingCard
                    booking={b}
                    onPress={
                      canEdit ? () => setBookingSheet({ open: true, booking: b }) : undefined
                    }
                  />
                  {canEdit && b.costMinor != null && b.costCurrency ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        addExpense({
                          description: titleOf(b),
                          amountMinor: b.costMinor!,
                          currency: b.costCurrency!,
                          spentOn: item.date ?? undefined,
                          category: categoryFor(b.type),
                          itemId: item.id,
                          bookingId: b.id,
                        })
                      }
                      style={styles.docRow}
                    >
                      <Feather name="credit-card" size={16} color={colors.accent} />
                      <Text style={styles.docName} numberOfLines={1}>
                        Add {formatCost(b.costMinor, b.costCurrency)} as an expense
                      </Text>
                    </Pressable>
                  ) : null}
                  {doc ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${doc.name}`}
                      onPress={() => void openDoc(doc)}
                      style={styles.docRow}
                    >
                      <Feather name="paperclip" size={16} color={colors.accent} />
                      <Text style={styles.docName} numberOfLines={1}>
                        {doc.name}
                      </Text>
                      <Body style={{ fontSize: 12 }}>
                        {typeLabel(doc.contentType)} · {fileSize(doc.sizeBytes)}
                      </Body>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
            {mine.length === 0 ? (
              <Body style={{ fontSize: 13 }}>
                {canEdit
                  ? 'Booked it? Add the confirmation code and times so nobody has to ask.'
                  : 'Nothing booked yet.'}
              </Body>
            ) : null}
            {canEdit ? (
              <Button
                label={mine.length === 0 ? 'Add booking' : 'Add another booking'}
                variant="outline"
                icon={<Feather name="plus" size={16} color={colors.ink} />}
                onPress={() => setBookingSheet({ open: true })}
              />
            ) : null}
          </View>

          {photos.length > 0 ? (
            <View style={{ gap: space.md }}>
              <Label>Photos · {photos.length}</Label>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoStrip}
              >
                {photos.map((photo) => (
                  <Pressable
                    key={photo.id}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Photo by ${photo.uploaderName ?? 'someone'}`}
                    onPress={() => setViewingPhoto(photo.id)}
                  >
                    <Image
                      source={
                        photo.thumbUrl
                          ? { uri: photo.thumbUrl, cacheKey: `${photo.id}-thumb` }
                          : undefined
                      }
                      style={styles.photoThumb}
                      contentFit="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={{ gap: space.md }}>
            <Label>Discussion</Label>
            {cursor ? <Button label="Show earlier" variant="ghost" onPress={loadOlder} /> : null}
            {thread.length === 0 ? (
              <Body style={{ fontSize: 13 }}>
                Talk about this one here. It stays out of the main chat.
              </Body>
            ) : (
              thread.map((m) => {
                const isMe = m.senderId === trip.myUserId;
                return (
                  <View
                    key={m.id}
                    style={[styles.msgRow, isMe && { flexDirection: 'row-reverse' }]}
                  >
                    <Avatar
                      name={m.senderName ?? '?'}
                      color={avatarColor(memberIndex.get(m.senderId ?? '') ?? 0)}
                      size={26}
                    />
                    <View
                      style={[
                        styles.bubble,
                        isMe ? styles.bubbleMine : styles.bubbleTheirs,
                        m.status === 'sending' && { opacity: 0.6 },
                      ]}
                    >
                      {!isMe ? <Text style={styles.sender}>{m.senderName}</Text> : null}
                      <Text style={[styles.msgBody, isMe && { color: '#FFFFFF' }]}>{m.body}</Text>
                      <Text style={[styles.msgTime, isMe && { color: colors.onAccentMuted }]}>
                        {m.status === 'failed' ? "Didn't send" : timeOf(m.createdAt)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>

        {canEdit ? (
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel={`Message about ${item.title}`}
              value={draft}
              onChangeText={setDraft}
              placeholder={`About ${item.title}…`}
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
              <Feather name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <ItemSheet
        visible={editing}
        item={item}
        defaultDay={dayKeyOf(item)}
        days={days}
        currency={trip.baseCurrency}
        canEdit={canEdit}
        onSave={saveItem}
        onDelete={deleteItem}
        onClose={closeEdit}
      />
      <PhotoViewer
        photos={photos}
        startId={viewingPhoto}
        canDelete={(photo) => photo.uploadedBy === trip.myUserId || trip.myRole === 'owner'}
        onDelete={async (photo) => {
          setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
          await request(`/photos/${photo.id}`, { method: 'DELETE' }).catch(() => void loadPhotos());
        }}
        onFavourite={(photo) => void favourite(photo)}
        onClose={() => setViewingPhoto(null)}
      />
      <BookingSheet
        visible={bookingSheet.open}
        booking={bookingSheet.booking}
        defaultType={BOOKING_FOR_ITEM[item.type]}
        currency={trip.baseCurrency}
        documents={docs}
        onSave={saveBooking}
        onDelete={deleteBooking}
        onClose={() => setBookingSheet({ open: false })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  expenseLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  expenseLinkText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.md,
  },
  editText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.xxl, paddingBottom: space.xxl },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notes: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  docName: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, gap: 2 },
  bubbleMine: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  sender: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  msgBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.ink },
  msgTime: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  photoStrip: { gap: space.sm },
  photoThumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.line },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
