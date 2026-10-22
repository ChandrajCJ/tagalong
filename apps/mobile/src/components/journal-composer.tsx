import Feather from '@expo/vector-icons/Feather';
import {
  CreateJournalEntryInput,
  JOURNAL_MOODS,
  JournalEntry,
  MAX_JOURNAL_MEDIA,
  MAX_JOURNAL_TEXT,
  newId,
  PhotoList,
  type JournalMood,
  type JournalPlace,
  type JournalVisibility,
  type Photo,
} from '@tagalong/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, request } from '@/lib/api';
import { pickFromLibrary } from '@/lib/chat-media';
import { drafts, MOOD_LABELS, type JournalDraft } from '@/lib/journal';
import { uploadPhoto } from '@/lib/photos';
import { colors, fonts, radius, space } from '@/theme';
import { AlbumPicker } from './album-picker';
import { PlaceField } from './place-field';
import { Body, Button, Label } from './ui';

interface Props {
  visible: boolean;
  tripId: string;
  date: string;
  /** The entry to change, or none to write a new one. */
  entry?: JournalEntry | null;
  /** A starter's words to begin with ("Best meal: "). */
  starter?: string | null;
  /** Editors can add new photos; viewers pick from the album. */
  canUpload: boolean;
  onSaved: (entry: JournalEntry) => void;
  onClose: () => void;
}

const EMPTY: JournalDraft = { body: '', mood: null, visibility: 'group', mediaIds: [], place: null };

/** Write or change a journal entry. A new one's words are kept on this device until it's sent. */
export function JournalComposer({ visible, tripId, date, entry, starter, canUpload, onSaved, onClose }: Props) {
  const [draft, setDraft] = useState<JournalDraft>(EMPTY);
  const [placeText, setPlaceText] = useState('');
  const [album, setAlbum] = useState<Photo[] | null>(null);
  const [known, setKnown] = useState<Photo[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // One id per new entry, so sending twice can't make two.
  const id = useRef(newId());
  const ready = useRef(false);

  useEffect(() => {
    if (!visible) return;
    ready.current = false;
    setError(undefined);
    id.current = newId();
    if (entry) {
      setDraft({ body: entry.body, mood: entry.mood, visibility: entry.visibility, mediaIds: entry.mediaIds, place: entry.place });
      setPlaceText(entry.place?.label ?? '');
      setKnown(entry.media);
      ready.current = true;
      return;
    }
    void drafts.get(tripId, date).then((saved) => {
      const start = saved && saved.body.trim() ? saved : { ...EMPTY, body: starter ?? '' };
      // A starter tapped on top of a saved draft is added to it.
      if (saved && starter && !saved.body.includes(starter)) start.body = `${saved.body.trimEnd()}\n\n${starter}`;
      setDraft(start);
      setPlaceText(start.place?.label ?? '');
      ready.current = true;
    });
  }, [visible, entry, starter, tripId, date]);

  // Photos for the thumbnails and the picker: the album, which has journal photos too.
  useEffect(() => {
    if (!visible || album) return;
    void request(`/trips/${tripId}/photos`, { schema: PhotoList })
      .then((list) => setAlbum(list.photos.filter((p) => p.status === 'ready')))
      .catch(() => setAlbum([]));
  }, [visible, album, tripId]);

  // Keep a new entry's draft as it's typed.
  useEffect(() => {
    if (!visible || entry || !ready.current) return;
    const timer = setTimeout(() => void drafts.set(tripId, date, draft.body.trim() || draft.mediaIds.length ? draft : null), 400);
    return () => clearTimeout(timer);
  }, [draft, visible, entry, tripId, date]);

  if (!visible) return null;
  const change = (patch: Partial<JournalDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const photoOf = (pid: string) => known.find((p) => p.id === pid) ?? album?.find((p) => p.id === pid);
  const room = MAX_JOURNAL_MEDIA - draft.mediaIds.length;

  const addNew = async () => {
    const picked = await pickFromLibrary(room);
    if (typeof picked === 'string') return setError(picked);
    if (picked.length === 0) return;
    setUploading((n) => n + picked.length);
    for (const asset of picked) {
      try {
        const photo = await uploadPhoto(tripId, asset, 'journal');
        setKnown((k) => [...k, photo]);
        setDraft((d) => ({ ...d, mediaIds: [...d.mediaIds, photo.id].slice(0, MAX_JOURNAL_MEDIA) }));
      } catch {
        setError('A photo didn’t upload. Try adding it again.');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const send = async () => {
    const place: JournalPlace | null = placeText.trim()
      ? draft.place && draft.place.label === placeText.trim()
        ? draft.place
        : { label: placeText.trim(), latitude: null, longitude: null, placeRef: null }
      : null;
    const fields = { body: draft.body, mood: draft.mood, visibility: draft.visibility, mediaIds: draft.mediaIds, place };
    const parsed = CreateJournalEntryInput.safeParse({ ...fields, date, id: id.current });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the entry');
    setBusy(true);
    setError(undefined);
    try {
      const saved = entry
        ? await request(`/journal/${entry.id}`, { method: 'PATCH', body: { ...fields, version: entry.version }, schema: JournalEntry })
        : await request(`/trips/${tripId}/journal`, { method: 'POST', body: parsed.data, schema: JournalEntry });
      if (!entry) await drafts.set(tripId, date, null);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save that. Your words are kept here; try again.');
    } finally {
      setBusy(false);
    }
  };

  const visibilityChoices: { value: JournalVisibility; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
    { value: 'group', label: 'The group', icon: 'users' },
    { value: 'private', label: 'Just me', icon: 'lock' },
  ];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
            <View style={styles.grabber} />
            <Text accessibilityRole="header" style={styles.title}>
              {entry ? (entry.kind === 'quote' ? 'Quote' : 'Edit entry') : 'Write about today'}
            </Text>

            {entry?.kind === 'quote' ? (
              <Body style={styles.quote}>“{entry.body}”</Body>
            ) : (
              <TextInput
                accessibilityLabel="What happened"
                value={draft.body}
                onChangeText={(body) => change({ body })}
                placeholder="What happened? What do you want to remember?"
                placeholderTextColor={colors.faint}
                multiline
                maxLength={MAX_JOURNAL_TEXT}
                autoFocus={!entry}
                style={styles.input}
              />
            )}

            <View style={{ gap: space.sm }}>
              <Label>Mood (optional)</Label>
              <View style={styles.chips}>
                {JOURNAL_MOODS.map((m: JournalMood) => {
                  const on = draft.mood === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="radio"
                      aria-checked={on}
                      accessibilityLabel={MOOD_LABELS[m]}
                      onPress={() => change({ mood: on ? null : m })}
                      style={[styles.mood, on && styles.chipOn]}
                    >
                      <Text style={{ fontSize: 22 }}>{m}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {entry?.kind !== 'quote' ? (
              <View style={{ gap: space.sm }}>
                <Label>Photos and videos (optional)</Label>
                {draft.mediaIds.length > 0 ? (
                  <View style={styles.thumbs}>
                    {draft.mediaIds.map((pid) => {
                      const p = photoOf(pid);
                      return (
                        <View key={pid} style={styles.thumb}>
                          {p?.thumbUrl ? <Image source={{ uri: p.thumbUrl, cacheKey: `${pid}-thumb` }} contentFit="cover" style={{ flex: 1 }} /> : null}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Remove this photo from the entry"
                            onPress={() => change({ mediaIds: draft.mediaIds.filter((x) => x !== pid) })}
                            style={styles.remove}
                          >
                            <Feather name="x" size={12} color={colors.onFill} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                <View style={styles.chips}>
                  <Button
                    label="From the album"
                    variant="outline"
                    icon={<Feather name="grid" size={16} color={colors.ink} />}
                    onPress={() => setPicking(true)}
                    disabled={room <= 0}
                    style={{ minHeight: 40 }}
                  />
                  {canUpload ? (
                    <Button
                      label={uploading ? `Adding ${uploading}…` : 'Add new'}
                      variant="outline"
                      icon={<Feather name="plus" size={16} color={colors.ink} />}
                      onPress={() => void addNew()}
                      disabled={room <= 0 || uploading > 0}
                      style={{ minHeight: 40 }}
                    />
                  ) : null}
                </View>
                {canUpload ? <Body style={{ fontSize: 12 }}>New ones go into the trip album too.</Body> : null}
              </View>
            ) : null}

            <PlaceField
              label="Where (optional)"
              value={placeText}
              picked={!!draft.place && draft.place.label === placeText && draft.place.latitude !== null}
              tripId={tripId}
              date={date}
              onChangeText={setPlaceText}
              onPick={(p) => {
                setPlaceText(p.name);
                change({ place: { label: p.name, latitude: p.latitude, longitude: p.longitude, placeRef: p.placeRef } });
              }}
              placeholder="A beach, a café, a viewpoint"
            />

            <View style={{ gap: space.sm }}>
              <Label>Who can see it</Label>
              <View style={styles.chips}>
                {visibilityChoices.map((v) => {
                  const on = draft.visibility === v.value;
                  return (
                    <Pressable
                      key={v.value}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => change({ visibility: v.value })}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Feather name={v.icon} size={14} color={on ? colors.onFill : colors.ink} />
                      <Text style={[styles.chipText, on && { color: colors.onFill }]}>{v.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Body style={{ fontSize: 12 }}>
                {draft.visibility === 'private'
                  ? 'Only you will ever see this entry. It’s left out of the recap.'
                  : 'Everyone on the trip can read it, react and comment.'}
              </Body>
            </View>

            {error ? <Body style={{ color: colors.coralInk }}>{error}</Body> : null}
            <Button label={entry ? 'Save' : 'Add to the journal'} onPress={() => void send()} loading={busy} disabled={uploading > 0} />
            <Button label="Cancel" variant="outline" onPress={onClose} />
            {!entry ? <Body style={{ fontSize: 12, textAlign: 'center' }}>What you’ve written stays here until you send it.</Body> : null}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
      <AlbumPicker
        visible={picking}
        photos={album}
        selected={draft.mediaIds}
        max={MAX_JOURNAL_MEDIA}
        title="Pick from the album"
        onDone={(ids) => {
          change({ mediaIds: ids });
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { maxHeight: '92%', backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  quote: { fontFamily: fonts.medium, fontSize: 17, color: colors.ink },
  input: { minHeight: 120, maxHeight: 260, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, fontFamily: fonts.medium, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mood: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.accentWash },
  remove: { position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
});
