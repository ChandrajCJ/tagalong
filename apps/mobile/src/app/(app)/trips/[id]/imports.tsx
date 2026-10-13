import Feather from '@expo/vector-icons/Feather';
import { DocumentList, hasRole, planItemFor, type BookingCandidate, type BookingImport, type TripDocument } from '@tagalong/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookingSheet, type BookingFields, type SaveResult } from '@/components/booking-sheet';
import { Body, Button, Label, Title } from '@/components/ui';
import { request } from '@/lib/api';
import { BOOKING_META, formatInZone } from '@/lib/bookings';
import { confidenceNote, useImports, useInbox } from '@/lib/imports';
import { shortDate } from '@/lib/plan';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

/** Files the server can read: PDFs and plain text, not pictures. */
const readable = (d: TripDocument) => d.contentType === 'application/pdf' || d.contentType === 'text/plain';

const headline = (c: BookingCandidate) => {
  const b = c.booking;
  const number = b.details.flightNumber ?? b.details.trainNumber;
  return [b.provider, typeof number === 'string' ? number : null].filter(Boolean).join(' ') || BOOKING_META[b.type].label;
};

const whereFrom = (i: BookingImport) =>
  i.source === 'email'
    ? `Forwarded by ${i.fromAddress ?? 'someone'}${i.subject ? `: “${i.subject}”` : ''}`
    : i.source === 'document'
      ? `From the file “${i.subject ?? 'in Docs'}”`
      : 'From an email you pasted';

/**
 * Bookings from email. Forward confirmations to
 * the trip's address, paste them, or read a ticket already in Docs; whatever
 * is found waits here to be checked and added. Nothing is added by itself.
 */
export default function ImportsScreen() {
  const { trip } = useTrip();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');
  const { pending, imports, error, load, read, add, dismiss } = useImports(trip?.id, canEdit);
  const { address, rotate } = useInbox(trip?.id, canEdit);
  const [docs, setDocs] = useState<TripDocument[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; itemId?: string | null }>();
  const [reviewing, setReviewing] = useState<{ found: BookingImport; index: number } | null>(null);
  const [addToPlan, setAddToPlan] = useState(true);

  useEffect(() => {
    if (!trip?.id) return;
    request(`/trips/${trip.id}/documents`, { schema: DocumentList })
      .then((d) => setDocs(d.documents.filter((x) => x.status === 'ready')))
      .catch(() => setDocs([]));
  }, [trip?.id]);

  const afterRead = (result: BookingImport | string) => {
    if (typeof result === 'string') return setToast({ text: result });
    const open = result.candidates.length;
    setToast({
      text:
        open === 0
          ? 'No booking found in that. Check it’s the confirmation itself, or add the booking by hand on a plan item.'
          : `Found ${open === 1 ? 'a booking' : `${open} bookings`}. Check ${open === 1 ? 'it' : 'them'} below and add.`,
    });
  };

  const findInText = async () => {
    if (!text.trim()) return;
    setBusy('paste');
    const result = await read({ text });
    setBusy(null);
    if (typeof result !== 'string') setText('');
    afterRead(result);
  };

  const findInDoc = async (doc: TripDocument) => {
    setBusy(doc.id);
    afterRead(await read({ documentId: doc.id }));
    setBusy(null);
  };

  // "Find booking in this" from Docs lands here with ?focus=<documentId>.
  useEffect(() => {
    if (!focus) return;
    router.setParams({ focus: undefined });
    const doc = docs.find((d) => d.id === focus);
    if (doc) void findInDoc(doc);
    // Only once the file list is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, docs]);

  const save = async (fields: BookingFields): Promise<SaveResult> => {
    if (!reviewing) return { error: 'Nothing to add' };
    const result = await add(reviewing.found, reviewing.index, fields, addToPlan);
    if ('error' in result) return { error: result.error };
    const item = addToPlan ? planItemFor(fields) : null;
    setToast({
      text: item
        ? `Added, and put in the plan${item.date ? ` on ${shortDate(item.date)}` : ' (no day yet)'}.`
        : 'Added. Open a plan item and add the booking there to link them.',
      itemId: result.itemId,
    });
    return { ok: true };
  };

  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    setToast({ text: 'Address copied. Forward booking emails to it from your own email address.' });
  };

  const confirmRotate = () =>
    Alert.alert('Change the forwarding address?', 'The old address stops working. Anyone forwarding to it needs the new one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change', style: 'destructive', onPress: () => void rotate().then((p) => p && setToast({ text: p })) },
    ]);

  if (!trip) return null;
  if (!canEdit) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Body style={{ textAlign: 'center' }}>Only editors can add bookings from email.</Body>
        <Button label="Back" variant="outline" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const handled = (imports ?? []).filter((i) => i.status !== 'pending').length;
  const reviewed = reviewing ? reviewing.found.candidates[reviewing.index] : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.ink} />
          </Pressable>
          <Title>Bookings from email</Title>
          <Body style={{ fontSize: 13 }}>
            Flights, trains, stays and tables found in confirmation emails wait here for you to check. Nothing is added
            until you tap Add.
          </Body>

          {toast ? (
            <View style={styles.toast} accessibilityLiveRegion="polite">
              <Body style={{ color: '#FFFFFF', flex: 1 }}>{toast.text}</Body>
              {toast.itemId ? (
                <Pressable accessibilityRole="link" onPress={() => router.push(`/trips/${trip.id}/items/${toast.itemId}`)}>
                  <Text style={styles.toastLink}>Open</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setToast(undefined)}>
                <Feather name="x" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}

          {/* What's waiting first: that's why people come here from the chat card. */}
          {error && !imports ? (
            <View style={{ gap: space.sm }}>
              <Body>{error}</Body>
              <Button label="Try again" variant="outline" onPress={load} />
            </View>
          ) : !imports ? (
            <ActivityIndicator color={colors.accent} />
          ) : pending.length > 0 ? (
            <View style={{ gap: space.md }}>
              <Label>To check</Label>
              {pending.map((found) => (
                <View key={found.id} style={{ gap: space.sm }}>
                  <Text style={styles.source} numberOfLines={2}>
                    {whereFrom(found)}
                  </Text>
                  {found.candidates.map((c, index) =>
                    c.state !== 'open' ? null : (
                      <View key={index} style={styles.candidate}>
                        <View style={styles.candidateTop}>
                          <View style={styles.typeIcon}>
                            <Feather name={BOOKING_META[c.booking.type].icon} size={16} color={colors.accent} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.candidateTitle}>{headline(c)}</Text>
                            <Text style={styles.candidateMeta}>
                              {[
                                typeof c.booking.details.from === 'string' && typeof c.booking.details.to === 'string'
                                  ? `${c.booking.details.from} → ${c.booking.details.to}`
                                  : null,
                                c.booking.startsAt ? formatInZone(c.booking.startsAt, c.booking.timezone) : 'No date found',
                                c.booking.reference ? `Ref ${c.booking.reference}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.confidence, c.confidence !== 'high' && { color: colors.coralInk }]}>{confidenceNote(c)}</Text>
                        <View style={styles.candidateButtons}>
                          <Button
                            label="Not this"
                            variant="outline"
                            style={{ flex: 1, minHeight: 44 }}
                            onPress={() => void dismiss(found, index).then((p) => p && setToast({ text: p }))}
                          />
                          <Button
                            label="Check and add"
                            style={{ flex: 1, minHeight: 44 }}
                            onPress={() => {
                              setAddToPlan(true);
                              setReviewing({ found, index });
                            }}
                          />
                        </View>
                      </View>
                    ),
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Body style={{ fontSize: 13 }}>
              Nothing to check right now.{handled > 0 ? ` ${handled} earlier ${handled === 1 ? 'email' : 'emails'} already handled.` : ''}
            </Body>
          )}

          {address ? (
            <View style={styles.card}>
              <Label>Forward to the trip</Label>
              <Body style={{ fontSize: 13 }}>
                Forward a confirmation from the email address you sign in with. It’s read within a few minutes and shows up
                here, with a note in chat.
              </Body>
              <Pressable accessibilityRole="button" accessibilityHint="Copies the address" onPress={() => void copy()} style={styles.address}>
                <Text style={styles.addressText} selectable numberOfLines={1}>
                  {address}
                </Text>
                <Feather name="copy" size={16} color={colors.accent} />
              </Pressable>
              {trip.myRole === 'owner' ? (
                <Pressable accessibilityRole="button" onPress={confirmRotate} style={styles.link}>
                  <Text style={styles.linkText}>Change the address</Text>
                </Pressable>
              ) : null}
            </View>
          ) : address === null ? (
            <Body style={{ fontSize: 13 }}>
              Forwarding emails isn’t set up on this server, so paste the email or read a ticket from Docs instead.
            </Body>
          ) : null}

          <View style={styles.card}>
            <Label>Paste the email</Label>
            <Body style={{ fontSize: 13 }}>Open the confirmation, select all its text, copy, and paste it here.</Body>
            <TextInput
              accessibilityLabel="Email text"
              value={text}
              onChangeText={setText}
              multiline
              placeholder="Your booking is confirmed. PNR: K7XQ2M…"
              placeholderTextColor="#8C867B"
              style={styles.paste}
            />
            <Button label="Find bookings" onPress={() => void findInText()} loading={busy === 'paste'} disabled={!text.trim()} />
          </View>

          <View style={styles.card}>
            <Label>Read a ticket from Docs</Label>
            {docs.filter(readable).length === 0 ? (
              <Body style={{ fontSize: 13 }}>No PDFs in Tickets & files yet. Add the ticket there first, then read it here.</Body>
            ) : (
              docs.filter(readable).map((d) => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityHint="Looks for a booking in this file"
                  disabled={busy !== null}
                  onPress={() => void findInDoc(d)}
                  style={styles.docRow}
                >
                  <Feather name="file-text" size={16} color={colors.accent} />
                  <Text style={styles.docName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  {busy === d.id ? <ActivityIndicator size="small" color={colors.accent} /> : <Feather name="search" size={15} color={colors.muted} />}
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BookingSheet
        visible={!!reviewing}
        tripId={trip.id}
        draft={reviewed ? { ...reviewed.booking, documentId: reviewing!.found.documentId } : undefined}
        draftNote={reviewed ? `${confidenceNote(reviewed)} ${addToPlan ? 'It’ll also go in the plan on its day.' : ''}` : undefined}
        defaultType={reviewed?.booking.type ?? 'flight'}
        currency={trip.baseCurrency}
        documents={docs}
        onSave={save}
        onClose={() => setReviewing(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxl * 2 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -space.sm },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
  toastLink: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF', textDecorationLine: 'underline' },
  source: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  candidate: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  candidateTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  typeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  candidateTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  candidateMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  confidence: { fontFamily: fonts.medium, fontSize: 12, color: colors.accent },
  candidateButtons: { flexDirection: 'row', gap: space.sm },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  address: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineStrong },
  addressText: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  link: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  paste: { minHeight: 140, maxHeight: 260, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.bg, fontFamily: fonts.body, fontSize: 14, color: colors.ink, textAlignVertical: 'top' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  docName: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
});
