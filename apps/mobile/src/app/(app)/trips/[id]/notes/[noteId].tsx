import Feather from '@expo/vector-icons/Feather';
import { hasRole, NOTE_MAX_CHARS, type TripNote } from '@tagalong/shared';
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
import { LinkedText } from '@/components/linked-text';
import { Body, Button } from '@/components/ui';
import { deleteNote, personName, saveNote, useTripNotes } from '@/lib/lists';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

/**
 * One trip note. Anyone reads it, with links and phone numbers tappable;
 * editors change it. If someone saved in between, both versions are shown
 * side by side to choose from: there's no live co-editing.
 */
export default function NoteScreen() {
  const { noteId, editing: startEditing } = useLocalSearchParams<{ noteId: string; editing?: string }>();
  const { trip } = useTrip();
  const { notes, error, load, upsert, drop } = useTripNotes(trip?.id);
  const note = notes?.find((n) => n.id === noteId);

  const [editing, setEditing] = useState(startEditing === '1');
  /** The copy the edit started from: its version is what the save is checked against. */
  const [base, setBase] = useState<TripNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [theirs, setTheirs] = useState<TripNote | null>(null);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Start an edit from the latest copy; while editing, other people's saves wait for the conflict check.
  useEffect(() => {
    if (note && editing && !base) {
      setBase(note);
      setTitle(note.title);
      setBody(note.body);
    }
  }, [note, editing, base]);

  if (!trip) return null;
  const canEdit = hasRole(trip.myRole, 'editor');

  if (!note) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        {notes === null && !error ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Body>{error ?? 'This note was deleted.'}</Body>
            {error ? <Button label="Try again" variant="outline" onPress={load} /> : null}
            <Button label="Back" variant="ghost" onPress={() => router.back()} />
          </>
        )}
      </SafeAreaView>
    );
  }

  const startEdit = () => {
    setBase(note);
    setTitle(note.title);
    setBody(note.body);
    setTheirs(null);
    setProblem(undefined);
    setEditing(true);
  };
  const stopEdit = () => {
    setEditing(false);
    setBase(null);
    setTheirs(null);
    setProblem(undefined);
  };

  const save = async (from: TripNote) => {
    if (!title.trim()) return setProblem('Give it a title');
    setBusy(true);
    const result = await saveNote(from, { title: title.trim(), body });
    setBusy(false);
    if ('saved' in result) {
      upsert(result.saved);
      return stopEdit();
    }
    if ('conflict' in result) {
      upsert(result.conflict);
      setBase(result.conflict);
      setTheirs(result.conflict);
      return;
    }
    setProblem(result.error);
  };

  const togglePin = async () => {
    const result = await saveNote(note, { pinned: !note.pinned });
    if ('saved' in result) upsert(result.saved);
    else if ('conflict' in result) upsert(result.conflict);
    else setProblem(result.error);
  };

  const confirmDelete = () =>
    Alert.alert(`Delete “${note.title}”?`, 'It goes for everyone on the trip.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const failed = await deleteNote(note.id);
          if (failed) return setProblem(failed);
          drop(note.id);
          router.back();
        },
      },
    ]);

  const who = personName(trip, (theirs ?? note).updatedBy) ?? 'someone';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        {canEdit && !editing ? (
          <View style={{ flexDirection: 'row' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={note.pinned ? 'Unpin' : 'Pin to the top'}
              onPress={() => void togglePin()}
              style={styles.iconButton}
            >
              <Feather name="bookmark" size={18} color={note.pinned ? colors.coral : colors.muted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete" onPress={confirmDelete} style={styles.iconButton}>
              <Feather name="trash-2" size={18} color={colors.muted} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={startEdit} style={styles.editButton}>
              <Feather name="edit-2" size={14} color={colors.accent} />
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {problem ? (
            <View style={styles.notice}>
              <Feather name="info" size={16} color={colors.coralInk} />
              <Body style={{ flex: 1, color: colors.coralInk }}>{problem}</Body>
            </View>
          ) : null}

          {theirs ? (
            <View style={{ gap: space.md }}>
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Feather name="users" size={16} color={colors.coralInk} />
                <Body style={{ flex: 1, color: colors.coralInk }}>
                  {who === 'you' ? 'You changed this note somewhere else' : `${who[0]!.toUpperCase()}${who.slice(1)} changed this note`} while you
                  were writing. Pick which one to keep.
                </Body>
              </View>
              <View style={styles.sideBySide}>
                <View style={styles.side}>
                  <Text style={styles.sideLabel}>Theirs</Text>
                  <Text style={styles.sideTitle}>{theirs.title}</Text>
                  <Text style={styles.sideBody}>{theirs.body || 'Empty'}</Text>
                </View>
                <View style={[styles.side, { borderColor: colors.accent }]}>
                  <Text style={styles.sideLabel}>Yours</Text>
                  <Text style={styles.sideTitle}>{title}</Text>
                  <Text style={styles.sideBody}>{body || 'Empty'}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <Button
                  label="Use theirs"
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setTitle(theirs.title);
                    setBody(theirs.body);
                    stopEdit();
                  }}
                />
                <Button label="Keep mine" style={{ flex: 1 }} loading={busy} onPress={() => void save(theirs)} />
              </View>
            </View>
          ) : editing && base ? (
            <>
              <TextInput
                accessibilityLabel="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="Title"
                placeholderTextColor="#8C867B"
                maxLength={100}
                style={styles.titleInput}
              />
              <TextInput
                accessibilityLabel="Note"
                value={body}
                onChangeText={setBody}
                placeholder={'Write anything the group should be able to find.\nLinks and phone numbers become tappable.'}
                placeholderTextColor="#8C867B"
                multiline
                maxLength={NOTE_MAX_CHARS}
                autoFocus={startEditing === '1'}
                style={styles.bodyInput}
              />
              {body.length > NOTE_MAX_CHARS - 1000 ? (
                <Text style={styles.hint}>
                  {body.length.toLocaleString()} of {NOTE_MAX_CHARS.toLocaleString()} characters
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {note.title}
              </Text>
              <Text style={styles.hint}>
                Last changed by {personName(trip, note.updatedBy)}
                {note.pinned ? ' · Pinned' : ''}
              </Text>
              {note.body ? (
                <LinkedText text={note.body} style={styles.read} />
              ) : (
                <Body>{canEdit ? 'Nothing here yet. Tap Edit to write it.' : 'Nothing here yet.'}</Body>
              )}
            </>
          )}
        </ScrollView>

        {editing && !theirs ? (
          <View style={styles.footer}>
            <Button label="Cancel" variant="outline" style={{ flex: 1 }} onPress={stopEdit} />
            <Button label="Save" style={{ flex: 1 }} loading={busy} onPress={() => base && void save(base)} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.md },
  editText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.md, paddingBottom: space.xxl },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  read: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.ink },
  titleInput: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  bodyInput: { minHeight: 260, fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.ink, textAlignVertical: 'top', padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  sideBySide: { flexDirection: 'row', gap: space.md },
  side: { flex: 1, gap: 4, padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface },
  sideLabel: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sideTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  sideBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
});
