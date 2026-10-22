import Feather from '@expo/vector-icons/Feather';
import { dayNumberOf, hasRole, JOURNAL_STARTERS, JournalEntry, type Photo } from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { JournalComposer } from '@/components/journal-composer';
import { JournalDayHeader } from '@/components/journal-day-header';
import { JournalEntryCard } from '@/components/journal-entry-card';
import { PhotoViewer } from '@/components/photo-viewer';
import { Avatar, Body, Button, Label } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { addDays } from '@/lib/dates';
import { useJournalDay } from '@/lib/journal';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

/** One day of the trip journal: the auto-filled header, then everyone's entries. */
export default function JournalDayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const { trip } = useTrip();
  const { day, setDay, error, reload } = useJournalDay(trip?.id, date);
  const [composer, setComposer] = useState<{ entry?: JournalEntry; starter?: string } | null>(null);
  const [viewing, setViewing] = useState<{ photos: Photo[]; startId: string } | null>(null);
  const [problem, setProblem] = useState<string>();

  if (!trip || !date) return null;
  const me = trip.myUserId;
  const isOwner = trip.myRole === 'owner';
  const colorOf = (userId: string) => avatarColor(Math.max(0, trip.members.findIndex((m) => m.userId === userId)));

  const replace = (entry: JournalEntry) =>
    setDay((d) => {
      if (!d) return d;
      const others = d.entries.filter((e) => e.id !== entry.id);
      return {
        ...d,
        entries: entry.date === date ? [...others, entry].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)) : others,
        writers: d.writers.includes(entry.authorId) ? d.writers : [...d.writers, entry.authorId],
      };
    });

  /** Runs a change and shows what came back, or says what went wrong. */
  const act = async (run: () => Promise<JournalEntry | void>) => {
    try {
      const next = await run();
      if (next) replace(next);
      else void reload();
      setProblem(undefined);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
      void reload();
    }
  };

  const go = (n: number) => router.setParams({ date: addDays(date, n) });
  const first = trip.startDate && date <= trip.startDate;
  const last = trip.endDate && date >= trip.endDate;
  const inTrip = dayNumberOf(trip.startDate, trip.endDate, date) !== null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}>
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/trips/${trip.id}/journal`)} style={styles.allDays}>
          <Text style={styles.allDaysText}>All days</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {inTrip ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="The day before" disabled={!!first} onPress={() => go(-1)} style={[styles.iconButton, first && { opacity: 0.3 }]}>
              <Feather name="arrow-left" size={20} color={colors.ink} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="The next day" disabled={!!last} onPress={() => go(1)} style={[styles.iconButton, last && { opacity: 0.3 }]}>
              <Feather name="arrow-right" size={20} color={colors.ink} />
            </Pressable>
          </>
        ) : null}
      </View>

      {error && !day ? (
        <View style={styles.center}>
          <Body>{error}</Body>
          <Button label="Try again" variant="outline" onPress={reload} />
        </View>
      ) : !day ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <JournalDayHeader tripId={trip.id} header={day.header} onOpenPhoto={(p) => setViewing({ photos: day.header.topPhotos, startId: p.id })} />

          <View style={{ gap: space.sm }}>
            <Label>Who’s written today</Label>
            <View style={styles.writers}>
              {trip.members.map((m, i) => {
                const wrote = day.writers.includes(m.userId);
                return (
                  <View
                    key={m.userId}
                    accessibilityLabel={`${m.userId === me ? 'You' : m.displayName}${wrote ? ' wrote something' : ''}`}
                    style={{ opacity: wrote ? 1 : 0.3 }}
                  >
                    <Avatar name={m.displayName} userId={m.userId} color={avatarColor(i)} size={30} />
                  </View>
                );
              })}
            </View>
          </View>

          {problem ? <Body style={{ color: colors.coralInk }}>{problem}</Body> : null}

          {day.entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing written yet</Text>
              <Body style={{ textAlign: 'center' }}>Start with one of these, or write anything at all.</Body>
              <View style={styles.starters}>
                {JOURNAL_STARTERS.map((s) => (
                  <Pressable key={s.key} accessibilityRole="button" onPress={() => setComposer({ starter: s.text })} style={styles.starter}>
                    <Text style={styles.starterText}>{s.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            day.entries.map((e) => (
              <JournalEntryCard
                key={e.id}
                entry={e}
                me={me}
                isOwner={isOwner}
                avatarColor={colorOf(e.authorId)}
                onEdit={() => setComposer({ entry: e })}
                onDelete={() =>
                  void act(async () => {
                    setDay((d) => (d ? { ...d, entries: d.entries.filter((x) => x.id !== e.id) } : d));
                    await request(`/journal/${e.id}`, { method: 'DELETE' });
                  })
                }
                onReact={(emoji) => void act(() => request(`/journal/${e.id}/reactions`, { method: 'POST', body: { emoji }, schema: JournalEntry }))}
                onComment={async (body) => {
                  try {
                    replace(await request(`/journal/${e.id}/comments`, { method: 'POST', body: { body }, schema: JournalEntry }));
                    return null;
                  } catch (err) {
                    return err instanceof ApiError ? err.message : 'Couldn’t send that comment';
                  }
                }}
                onDeleteComment={(commentId) => void act(() => request(`/journal-comments/${commentId}`, { method: 'DELETE' }))}
                onOpenPhoto={(p, all) => setViewing({ photos: all, startId: p.id })}
              />
            ))
          )}
        </ScrollView>
      )}

      {day ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Write about this day" onPress={() => setComposer({})} style={styles.fab}>
          <Feather name="edit-3" size={20} color={colors.onFill} />
          <Text style={styles.fabText}>Write</Text>
        </Pressable>
      ) : null}

      <JournalComposer
        visible={!!composer}
        tripId={trip.id}
        date={date}
        entry={composer?.entry ?? null}
        starter={composer?.starter ?? null}
        canUpload={hasRole(trip.myRole, 'editor')}
        onSaved={replace}
        onClose={() => setComposer(null)}
      />
      {viewing ? (
        <PhotoViewer
          photos={viewing.photos}
          startId={viewing.startId}
          canDelete={() => false}
          onDelete={async () => {}}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  allDays: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  allDaysText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent },
  body: { padding: space.xl, paddingTop: space.sm, paddingBottom: 120, gap: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  writers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  starter: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  starterText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  fab: { position: 'absolute', right: space.xl, bottom: space.xl, flexDirection: 'row', gap: 6, height: 52, paddingHorizontal: 18, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  fabText: { fontFamily: fonts.bold, fontSize: 15, color: colors.onFill },
});
