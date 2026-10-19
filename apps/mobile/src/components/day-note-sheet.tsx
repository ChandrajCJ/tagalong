import Feather from '@expo/vector-icons/Feather';
import { TripDay } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, request } from '@/lib/api';
import { shortDate } from '@/lib/plan';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field } from './ui';

interface Props {
  visible: boolean;
  tripId: string;
  date: string;
  /** The day as last seen, or undefined if nobody has written anything for it yet. */
  day?: TripDay;
  onSaved: (day: TripDay) => void;
  onClose: () => void;
}

/** A day's own title and note: "Sintra day", "9:10 train from Rossio". */
export function DayNoteSheet({ visible, tripId, date, day, onSaved, onClose }: Props) {
  const [base, setBase] = useState(day);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setBase(day);
    setTitle(day?.title ?? '');
    setNotes(day?.notes ?? '');
    setNotice(undefined);
    // Fresh each time it opens, not each time someone else saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, date]);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await request(`/trips/${tripId}/days/${date}`, {
        method: 'PUT',
        body: { title: title.trim() || null, notes: notes.trim() || null, version: base?.version },
        schema: TripDay,
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && TripDay.safeParse(e.data.current);
      if (latest && latest.success) {
        // Someone saved first: show theirs, so nothing is silently lost.
        onSaved(latest.data);
        setBase(latest.data);
        setTitle(latest.data.title ?? '');
        setNotes(latest.data.notes ?? '');
        setNotice('Someone changed this day’s note while you were writing. You’re now seeing theirs; edit and save again if needed.');
      } else {
        setNotice(e instanceof ApiError ? e.message : 'Could not save that');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {shortDate(date)}
          </Text>
          <Body style={{ fontSize: 13 }}>A name for the day and a note everyone sees above its plan. Both optional.</Body>
          {notice ? (
            <View style={styles.notice} accessibilityLiveRegion="polite">
              <Feather name="info" size={16} color={colors.coralInk} />
              <Body style={{ flex: 1, color: colors.coralInk }}>{notice}</Body>
            </View>
          ) : null}
          <Field label="Name" value={title} onChangeText={setTitle} placeholder="Sintra day" maxLength={100} />
          <Field
            label="Note"
            value={notes}
            onChangeText={setNotes}
            placeholder="9:10 train from Rossio. Bring cash for the palace."
            multiline
            maxLength={2000}
            style={{ height: 96, paddingTop: 14, textAlignVertical: 'top' }}
          />
          <Button label="Save" onPress={() => void save()} loading={busy} />
          <Button label="Cancel" variant="outline" onPress={onClose} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  notice: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
});
