import Feather from '@expo/vector-icons/Feather';
import {
  hasRole,
  Idea,
  IdeaList,
  ItemList,
  ItineraryItem,
  newId,
  PromoteResult,
  type VoteValue,
} from '@tagalong/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DayPicker } from '@/components/day-picker';
import { IdeaSheet, type IdeaFields, type SaveResult } from '@/components/idea-sheet';
import { Avatar, Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { ITEM_TYPE_META, planDays } from '@/lib/plan';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { avatarColor, colors, fonts, radius, space } from '@/theme';

/** Most support first, newest first among equals — the same order the API uses. */
const byScore = (a: Idea, b: Idea) =>
  b.ups - b.downs - (a.ups - a.downs) || b.updatedAt.localeCompare(a.updatedAt);

/**
 * The shared "maybe" list (design: Ideas.dc.html). Anyone can vote, including
 * viewers; editors can add ideas and move them into the plan.
 */
export default function IdeasTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<{ open: boolean; idea?: Idea }>({ open: false });
  const [promoting, setPromoting] = useState<Idea>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tripId = trip?.id;
  const canEdit = !!trip && hasRole(trip.myRole, 'editor');

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 3500);
  };

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const [board, plan] = await Promise.all([
        request(`/trips/${tripId}/ideas`, { schema: IdeaList }),
        request(`/trips/${tripId}/items`, { schema: ItemList }),
      ]);
      setIdeas(board.ideas);
      setItems(plan.items);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the ideas');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Applies a newer copy; ignores anything older than what we already have. */
  const upsertLocal = useCallback((idea: Idea) => {
    setIdeas((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((p) => p.id === idea.id);
      if (i === -1) return [...prev, idea];
      if (prev[i]!.version > idea.version) return prev;
      const next = [...prev];
      next[i] = idea;
      return next;
    });
  }, []);
  const removeLocal = useCallback((id: string) => {
    setIdeas((prev) => prev?.filter((p) => p.id !== id) ?? prev);
  }, []);

  useTripRealtime(tripId, (message) => {
    if (message.kind === 'reconnected') return void load();
    if (message.kind === 'error' && message.code === 'removed') return router.replace('/trips');
    if (message.kind !== 'event') return;

    const { event } = message;
    if (event.type === 'idea.upserted' || event.type === 'idea.voted') {
      const parsed = Idea.safeParse(event.payload);
      // The payload carries the sender's own `myVote`, so keep ours.
      if (parsed.success) {
        setIdeas((prev) => {
          if (!prev) return prev;
          const mine = prev.find((p) => p.id === parsed.data.id);
          const theirs = parsed.data;
          const merged: Idea = {
            ...theirs,
            myVote: theirs.voters.find((v) => v.userId === trip?.myUserId)?.value ?? null,
          };
          if (!mine) return [...prev, merged];
          if (mine.version > merged.version) return prev;
          return prev.map((p) => (p.id === merged.id ? merged : p));
        });
      }
    } else if (event.type === 'idea.deleted') {
      removeLocal(event.entityId);
    } else if (event.type === 'item.upserted' || event.type === 'item.deleted') {
      // Someone promoted something: the plan's days may have changed.
      void load();
    } else if (event.type.startsWith('member.')) {
      void reloadTrip();
    }
  });

  const sorted = useMemo(() => [...(ideas ?? [])].sort(byScore), [ideas]);
  const days = useMemo(
    () => (trip ? planDays(trip.startDate, trip.endDate, items) : []),
    [trip, items],
  );

  const vote = async (idea: Idea, value: VoteValue) => {
    const clearing = idea.myVote === value;
    const next = clearing ? null : value;

    // Move the count straight away, then confirm with the server.
    const others = idea.voters.filter((v) => v.userId !== trip?.myUserId);
    const voters = next
      ? [
          ...others,
          { userId: trip!.myUserId, displayName: 'You', value: next },
        ]
      : others;
    upsertLocal({
      ...idea,
      myVote: next,
      voters,
      ups: voters.filter((v) => v.value === 'up').length,
      downs: voters.filter((v) => v.value === 'down').length,
    });

    try {
      const saved = await request(`/ideas/${idea.id}/vote`, {
        method: clearing ? 'DELETE' : 'PUT',
        body: clearing ? undefined : { value },
        schema: Idea,
      });
      upsertLocal(saved);
    } catch (e) {
      upsertLocal(idea); // put it back
      showToast(e instanceof ApiError ? e.message : 'Could not save your vote');
    }
  };

  const save = async (fields: IdeaFields): Promise<SaveResult> => {
    if (!trip) return { error: 'Trip not loaded' };
    const existing = sheet.idea;

    if (!existing) {
      const id = newId();
      const optimistic: Idea = {
        ...fields,
        id,
        tripId: trip.id,
        createdBy: trip.myUserId,
        promotedItemId: null,
        version: 0,
        updatedAt: new Date().toISOString(),
        ups: 0,
        downs: 0,
        voters: [],
        myVote: null,
      };
      upsertLocal(optimistic);
      try {
        upsertLocal(
          await request(`/trips/${trip.id}/ideas`, {
            method: 'POST',
            body: { ...fields, id },
            schema: Idea,
          }),
        );
        return { ok: true };
      } catch (e) {
        removeLocal(id);
        return { error: e instanceof ApiError ? e.message : 'Could not add that' };
      }
    }

    try {
      upsertLocal(
        await request(`/ideas/${existing.id}`, {
          method: 'PATCH',
          body: { ...fields, version: existing.version },
          schema: Idea,
        }),
      );
      return { ok: true };
    } catch (e) {
      const latest = e instanceof ApiError && e.status === 409 && Idea.safeParse(e.data.current);
      if (latest && latest.success) {
        upsertLocal(latest.data);
        setSheet({ open: true, idea: latest.data });
        return { conflict: latest.data };
      }
      return { error: e instanceof ApiError ? e.message : 'Could not save that' };
    }
  };

  const remove = async () => {
    const existing = sheet.idea;
    if (!existing) return;
    removeLocal(existing.id);
    try {
      await request(`/ideas/${existing.id}`, { method: 'DELETE' });
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not remove that');
      void load();
    }
  };

  const promote = async (date: string | null) => {
    const idea = promoting;
    if (!idea) return;
    setBusy(true);
    try {
      const res = await request(`/ideas/${idea.id}/promote`, {
        method: 'POST',
        body: { date },
        schema: PromoteResult,
      });
      upsertLocal(res.idea);
      setPromoting(undefined);
      showToast(`“${idea.title}” is in the plan`);
      void load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not move that into the plan');
    } finally {
      setBusy(false);
    }
  };

  if (!trip) return null;

  const renderIdea = ({ item: idea }: { item: Idea }) => {
    const score = idea.ups - idea.downs;
    const voted = (value: VoteValue) => idea.myVote === value;
    return (
      <View style={[styles.card, idea.promotedItemId && styles.cardPromoted]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={idea.title}
          accessibilityHint={canEdit ? 'Double tap to edit.' : 'Double tap for details.'}
          onPress={() => setSheet({ open: true, idea })}
          style={styles.cardMain}
        >
          <View style={styles.cardTop}>
            <Feather name={ITEM_TYPE_META[idea.type].icon} size={16} color={colors.accent} />
            <Text style={styles.cardTitle} numberOfLines={2}>
              {idea.title}
            </Text>
          </View>
          {idea.note ? (
            <Body style={{ fontSize: 13 }} numberOfLines={2}>
              {idea.note}
            </Body>
          ) : null}
          {idea.voters.length > 0 ? (
            <View style={styles.faces}>
              {idea.voters.slice(0, 5).map((v, i) => (
                <View key={v.userId} style={{ marginLeft: i === 0 ? 0 : -8, opacity: v.value === 'up' ? 1 : 0.4 }}>
                  <Avatar name={v.displayName} color={avatarColor(i)} size={22} />
                </View>
              ))}
              {idea.voters.length > 5 ? (
                <Text style={styles.moreFaces}>+{idea.voters.length - 5}</Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>

        <View style={styles.actions}>
          <View style={styles.voteBox}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voted('up') ? 'Remove your yes' : `Vote yes for ${idea.title}`}
              aria-checked={voted('up')}
              onPress={() => vote(idea, 'up')}
              style={[styles.voteButton, voted('up') && styles.voteOn]}
            >
              <Feather name="thumbs-up" size={15} color={voted('up') ? '#FFFFFF' : colors.ink} />
            </Pressable>
            <Text style={styles.score} accessibilityLabel={`${idea.ups} yes, ${idea.downs} no`}>
              {score > 0 ? `+${score}` : score}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voted('down') ? 'Remove your no' : `Vote no for ${idea.title}`}
              aria-checked={voted('down')}
              onPress={() => vote(idea, 'down')}
              style={[styles.voteButton, voted('down') && styles.voteDownOn]}
            >
              <Feather name="thumbs-down" size={15} color={voted('down') ? '#FFFFFF' : colors.ink} />
            </Pressable>
          </View>

          {idea.url ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open link"
              onPress={() => void Linking.openURL(idea.url!)}
              style={styles.iconButton}
            >
              <Feather name="external-link" size={16} color={colors.muted} />
            </Pressable>
          ) : null}

          {idea.promotedItemId ? (
            <View style={styles.inPlan}>
              <Feather name="check" size={13} color={colors.accentInk} />
              <Text style={styles.inPlanText}>In the plan</Text>
            </View>
          ) : canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${idea.title} to the plan`}
              onPress={() => setPromoting(idea)}
              style={styles.promote}
            >
              <Feather name="calendar" size={14} color={colors.accent} />
              <Text style={styles.promoteText}>Add to plan</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Title>Ideas</Title>
        <Body style={{ fontSize: 13 }}>
          Anything the group is considering. Everyone votes, even viewers.
        </Body>
      </View>

      {toast ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Body style={{ color: '#FFFFFF' }}>{toast}</Body>
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Body>{error}</Body>
          <Button label="Try again" variant="outline" onPress={load} />
        </View>
      ) : !ideas ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(i) => i.id}
          renderItem={renderIdea}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="zap" size={28} color={colors.accent} />
              <Body style={{ textAlign: 'center' }}>
                No ideas yet. Drop the first one and see what everyone thinks.
              </Body>
              {canEdit ? (
                <Button
                  label="Add an idea"
                  variant="outline"
                  onPress={() => setSheet({ open: true })}
                />
              ) : null}
            </View>
          }
        />
      )}

      {canEdit && ideas && ideas.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an idea"
          onPress={() => setSheet({ open: true })}
          style={styles.fab}
        >
          <Feather name="plus" size={26} color="#FFFFFF" />
        </Pressable>
      ) : null}

      <IdeaSheet
        visible={sheet.open}
        idea={sheet.idea}
        canEdit={canEdit}
        onSave={save}
        onDelete={remove}
        onClose={() => setSheet({ open: false })}
      />

      <DayPicker
        visible={!!promoting}
        title="Which day?"
        subtitle={promoting?.title}
        days={days}
        busy={busy}
        onPick={promote}
        onClose={() => setPromoting(undefined)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, gap: 4 },
  list: { padding: space.xl, paddingTop: space.md, paddingBottom: 120, gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: space.sm, overflow: 'hidden' },
  cardPromoted: { borderColor: colors.accentSoft, backgroundColor: '#FBFDFC' },
  cardMain: { padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  faces: { flexDirection: 'row', alignItems: 'center', paddingTop: 2 },
  moreFaces: { marginLeft: 6, fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 14, paddingBottom: 12 },
  voteBox: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, padding: 2 },
  voteButton: { minWidth: 36, minHeight: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  voteOn: { backgroundColor: colors.accent },
  voteDownOn: { backgroundColor: colors.coral },
  score: { minWidth: 24, textAlign: 'center', fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  iconButton: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  promote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto', minHeight: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  promoteText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  inPlan: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingHorizontal: 10, minHeight: 36, justifyContent: 'center' },
  inPlanText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  fab: { position: 'absolute', right: space.xl, bottom: space.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  toast: { marginHorizontal: space.xl, marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
});
