import Feather from '@expo/vector-icons/Feather';
import {
  everyoneProgress,
  hasRole,
  isDoneFor,
  type ListItem,
  type ListItemScope,
  type ListKind,
  type TripList,
} from '@tagalong/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { PackingSuggestions } from '@/components/packing-suggestions';
import { TextPrompt } from '@/components/text-prompt';
import { Body, Button, Title } from '@/components/ui';
import { addDays } from '@/lib/dates';
import { createNote, KIND_LABEL, personName, useTripLists, useTripNotes } from '@/lib/lists';
import { shortDate } from '@/lib/plan';
import { VIEWER_NOTE } from '@/lib/roles';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type Tab = ListKind | 'notes';
const TABS: { key: Tab; label: string }[] = [
  { key: 'packing', label: 'Packing' },
  { key: 'todo', label: 'To-dos' },
  { key: 'notes', label: 'Notes' },
];

/** What a list's add box suggests writing. */
const PLACEHOLDER: Record<ListKind, string> = { packing: 'Add something to pack', todo: 'Add a to-do, e.g. Book Sintra tickets' };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Getting ready for the trip: packing, to-dos and notes in one place.
 * Packing and to-dos tick on tap; hold a line for more. "Each person" lines
 * are ticked by everyone for themselves, the rest once for the group.
 */
export default function ListsScreen() {
  const { trip } = useTrip();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === params.tab) ? params.tab! : 'packing');
  const lists = useTripLists(trip);
  const notes = useTripNotes(trip?.id);
  const [toast, setToast] = useState<string>();
  const [draft, setDraft] = useState('');
  const [draftScope, setDraftScope] = useState<ListItemScope>('everyone');
  const [menu, setMenu] = useState<ListItem | null>(null);
  const [listMenu, setListMenu] = useState<TripList | null>(null);
  const [prompt, setPrompt] = useState<
    | { kind: 'edit'; item: ListItem }
    | { kind: 'rename'; list: TripList }
    | { kind: 'new-list' }
    | { kind: 'new-note' }
    | null
  >(null);
  const [picker, setPicker] = useState<{ kind: 'assign' | 'due'; item: ListItem } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  // "Each person" lines whose "who hasn't" is open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!trip) return null;
  const canEdit = hasRole(trip.myRole, 'editor');
  const memberIds = trip.members.map((m) => m.userId);
  const say = (problem: string | null) => {
    if (problem) setToast(problem);
  };

  const kind: ListKind | null = tab === 'notes' ? null : tab;
  const kindLists = (lists.lists ?? []).filter((l) => l.kind === kind);
  const itemsOf = (listId: string) => lists.items.filter((i) => i.listId === listId);
  const kindItems = kindLists.flatMap((l) => itemsOf(l.id));

  const addLine = async () => {
    const text = draft.trim();
    if (!text || !kind) return;
    setDraft('');
    say(await lists.add({ kind, text, scope: kind === 'packing' ? draftScope : 'shared' }));
  };

  const lineActions = (item: ListItem): MenuAction[] => [
    { icon: 'edit-2', label: 'Edit', onPress: () => setPrompt({ kind: 'edit', item }) },
    item.scope === 'shared'
      ? {
          icon: 'users',
          label: 'Each person ticks their own',
          hint: 'Like a passport: everyone needs one',
          onPress: () => void lists.update(item, { scope: 'everyone', assigneeId: null }).then(say),
        }
      : {
          icon: 'user',
          label: 'One tick for the group',
          hint: 'Like a first-aid kit: one is enough',
          onPress: () => void lists.update(item, { scope: 'shared' }).then(say),
        },
    ...(item.scope === 'shared'
      ? [{ icon: 'user-check' as const, label: item.assigneeId ? 'Change who’s on it' : 'Assign to someone', onPress: () => setPicker({ kind: 'assign', item }) }]
      : []),
    { icon: 'calendar', label: item.dueDate ? 'Change the due date' : 'Add a due date', onPress: () => setPicker({ kind: 'due', item }) },
    ...(item.itemId
      ? [{ icon: 'map-pin' as const, label: 'Open the plan item', onPress: () => router.push(`/trips/${trip.id}/items/${item.itemId}`) }]
      : []),
    {
      icon: 'trash-2',
      label: 'Delete',
      destructive: true,
      onPress: () => void lists.remove(item).then(say),
    },
  ];

  const pickerActions = (): MenuAction[] => {
    if (!picker) return [];
    const { item } = picker;
    if (picker.kind === 'assign') {
      return [
        ...trip.members.map(
          (m): MenuAction => ({
            icon: m.userId === item.assigneeId ? 'check' : 'user',
            label: m.userId === trip.myUserId ? `${m.displayName} (you)` : m.displayName,
            onPress: () => void lists.update(item, { assigneeId: m.userId }).then(say),
          }),
        ),
        ...(item.assigneeId
          ? [{ icon: 'x' as const, label: 'Nobody yet', onPress: () => void lists.update(item, { assigneeId: null }).then(say) }]
          : []),
      ];
    }
    const due = (date: string | null): MenuAction['onPress'] => () => void lists.update(item, { dueDate: date }).then(say);
    const options: MenuAction[] = [
      { icon: 'calendar', label: 'Today', onPress: due(today()) },
      { icon: 'calendar', label: 'Tomorrow', onPress: due(addDays(today(), 1)) },
      { icon: 'calendar', label: 'In a week', onPress: due(addDays(today(), 7)) },
    ];
    if (trip.startDate && trip.startDate > addDays(today(), 7)) {
      options.push(
        { icon: 'calendar', label: 'A week before the trip', hint: shortDate(addDays(trip.startDate, -7)), onPress: due(addDays(trip.startDate, -7)) },
        { icon: 'calendar', label: 'The day before the trip', hint: shortDate(addDays(trip.startDate, -1)), onPress: due(addDays(trip.startDate, -1)) },
      );
    }
    if (item.dueDate) options.push({ icon: 'x', label: 'No due date', onPress: due(null) });
    return options;
  };

  const confirmDeleteList = (list: TripList) =>
    Alert.alert(`Delete “${list.title}”?`, 'Everything on it goes too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void lists.deleteList(list).then(say) },
    ]);

  const renderLine = (item: ListItem) => {
    const done = isDoneFor(item, trip.myUserId);
    const progress = item.scope === 'everyone' ? everyoneProgress(item, memberIds) : null;
    const open = expanded.has(item.id);
    const canTick = item.scope === 'everyone' || canEdit;
    const details = [
      item.scope === 'shared' && item.assigneeId
        ? `${personName(trip, item.assigneeId) === 'you' ? 'You’re' : `${personName(trip, item.assigneeId)}’s`} ${kind === 'packing' ? 'bringing it' : 'on it'}`
        : null,
      item.scope === 'shared' && item.doneBy ? `Ticked by ${personName(trip, item.doneBy)}` : null,
      item.dueDate ? `Due ${shortDate(item.dueDate)}` : null,
    ].filter(Boolean);
    return (
      <View key={item.id} style={styles.line}>
        <Pressable
          accessibilityRole="checkbox"
          aria-checked={done}
          aria-disabled={!canTick}
          accessibilityHint={canEdit ? 'Hold for more options' : undefined}
          onPress={() => void lists.toggle(item, canEdit).then(say)}
          onLongPress={canEdit ? () => setMenu(item) : undefined}
          delayLongPress={300}
          style={styles.lineMain}
        >
          <View style={[styles.box, item.scope === 'everyone' && styles.boxRound, done && styles.boxOn, !canTick && { opacity: 0.4 }]}>
            {done ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.lineText, done && styles.lineDone]}>{item.text}</Text>
            {details.length > 0 ? <Text style={styles.lineMeta}>{details.join(' · ')}</Text> : null}
          </View>
        </Pressable>
        {progress ? (
          <Pressable
            accessibilityRole="button"
            aria-expanded={open}
            accessibilityLabel={`${progress.checked} of ${progress.total} ${kind === 'packing' ? 'packed' : 'done'}. Show who hasn't`}
            onPress={() =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
            style={styles.count}
          >
            <Text style={[styles.countText, progress.checked === progress.total && { color: colors.accent }]}>
              {progress.checked} of {progress.total}
            </Text>
            <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`More for ${item.text}`} onPress={() => setMenu(item)} style={styles.more}>
            <Feather name="more-horizontal" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
        {progress && open ? (
          <Text style={styles.waiting}>
            {progress.waitingFor.length === 0
              ? 'Everyone has ticked this.'
              : `Not yet: ${progress.waitingFor.map((id) => (id === trip.myUserId ? 'you' : personName(trip, id))).join(', ')}`}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderChecklists = () => {
    if (!kind) return null;
    if (lists.error && !lists.lists) {
      return (
        <View style={styles.center}>
          <Body>{lists.error}</Body>
          <Button label="Try again" variant="outline" onPress={lists.load} />
        </View>
      );
    }
    if (!lists.lists) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    const done = kindItems.filter((i) => isDoneFor(i, trip.myUserId)).length;
    return (
      <>
        <Body style={{ fontSize: 13 }}>
          {kindItems.length === 0
            ? kind === 'packing'
              ? 'Nothing to pack yet. Lines marked “each person” are ticked by everyone for themselves.'
              : 'No to-dos yet: tickets to book, visas, someone to tell. Each can be assigned and given a date.'
            : `${done} of ${kindItems.length} ${kind === 'packing' ? 'packed' : 'done'}, as far as you’re concerned.${canEdit ? ' Tap to tick; hold a line for more.' : ''}`}
        </Body>

        {kind === 'packing' && canEdit && kindItems.length === 0 ? (
          <Button
            label="Start with suggestions"
            icon={<Feather name="zap" size={16} color="#FFFFFF" />}
            onPress={() => setSuggesting(true)}
          />
        ) : null}

        {kindLists.map((list) => {
          const lines = itemsOf(list.id);
          return (
            <View key={list.id} style={{ gap: space.sm }}>
              {kindLists.length > 1 || list.title !== KIND_LABEL[list.kind] ? (
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>{list.title}</Text>
                  {canEdit ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`More for ${list.title}`} onPress={() => setListMenu(list)} style={styles.more}>
                      <Feather name="more-horizontal" size={18} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {lines.length > 0 ? <View style={styles.card}>{lines.map(renderLine)}</View> : null}
            </View>
          );
        })}

        {canEdit ? (
          <View style={{ gap: space.sm }}>
            <View style={styles.addRow}>
              <TextInput
                accessibilityLabel={PLACEHOLDER[kind]}
                value={draft}
                onChangeText={setDraft}
                placeholder={PLACEHOLDER[kind]}
                placeholderTextColor="#8C867B"
                returnKeyType="done"
                onSubmitEditing={() => void addLine()}
                maxLength={200}
                style={styles.addInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add"
                aria-disabled={!draft.trim()}
                onPress={() => void addLine()}
                style={[styles.addButton, !draft.trim() && { opacity: 0.4 }]}
              >
                <Feather name="plus" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            {kind === 'packing' ? (
              <View style={styles.scopeRow} accessibilityRole="radiogroup">
                {(
                  [
                    ['everyone', 'Each person packs one'],
                    ['shared', 'One for the group'],
                  ] as const
                ).map(([scope, label]) => (
                  <Pressable
                    key={scope}
                    accessibilityRole="radio"
                    aria-checked={draftScope === scope}
                    onPress={() => setDraftScope(scope)}
                    style={[styles.scopeChip, draftScope === scope && styles.scopeChipOn]}
                  >
                    <Text style={[styles.scopeText, draftScope === scope && { color: '#FFFFFF' }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setPrompt({ kind: 'new-list' })} style={styles.newList}>
              <Feather name="list" size={14} color={colors.accent} />
              <Text style={styles.newListText}>Start another {kind === 'packing' ? 'packing' : 'to-do'} list</Text>
            </Pressable>
          </View>
        ) : (
          <Body style={{ fontSize: 13 }}>
            {kind === 'packing' ? 'You can tick your own packing. ' : ''}
            {VIEWER_NOTE}
          </Body>
        )}
      </>
    );
  };

  const renderNotes = () => {
    if (notes.error && !notes.notes) {
      return (
        <View style={styles.center}>
          <Body>{notes.error}</Body>
          <Button label="Try again" variant="outline" onPress={notes.load} />
        </View>
      );
    }
    if (!notes.notes) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    return (
      <>
        <Body style={{ fontSize: 13 }}>
          {notes.notes.length === 0
            ? 'Things everyone should be able to find: emergency numbers, Wi-Fi codes, useful phrases.'
            : 'Links and phone numbers in notes can be tapped.'}
        </Body>
        {notes.notes.map((note) => (
          <Pressable
            key={note.id}
            accessibilityRole="button"
            onPress={() => router.push(`/trips/${trip.id}/notes/${note.id}`)}
            style={({ pressed }) => [styles.noteCard, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.noteTop}>
              {note.pinned ? <Feather name="bookmark" size={14} color={colors.coral} accessibilityLabel="Pinned" /> : null}
              <Text style={styles.noteTitle} numberOfLines={1}>
                {note.title}
              </Text>
              <Feather name="chevron-right" size={18} color="#8C867B" />
            </View>
            {note.body ? (
              <Body numberOfLines={2} style={{ fontSize: 13 }}>
                {note.body}
              </Body>
            ) : null}
          </Pressable>
        ))}
        {canEdit ? (
          <Button
            label="New note"
            variant="outline"
            icon={<Feather name="plus" size={16} color={colors.ink} />}
            onPress={() => setPrompt({ kind: 'new-note' })}
          />
        ) : (
          <Body style={{ fontSize: 13 }}>{VIEWER_NOTE}</Body>
        )}
      </>
    );
  };

  const promptProps = (() => {
    if (!prompt) return null;
    switch (prompt.kind) {
      case 'edit':
        return {
          title: 'Edit',
          label: 'What',
          initial: prompt.item.text,
          onSave: (v: string) => lists.update(prompt.item, { text: v }),
        };
      case 'rename':
        return {
          title: 'Rename the list',
          label: 'Name',
          initial: prompt.list.title,
          onSave: (v: string) => lists.renameList(prompt.list, v),
        };
      case 'new-list':
        return {
          title: `New ${kind === 'packing' ? 'packing' : 'to-do'} list`,
          message: kind === 'packing' ? 'For example “Beach day bag” or “Kids’ things”.' : 'For example “Before we leave” or “On the day”.',
          label: 'Name',
          initial: '',
          saveLabel: 'Make the list',
          onSave: (v: string) => lists.createList(kind ?? 'packing', v),
        };
      case 'new-note':
        return {
          title: 'New note',
          message: 'Give it a title; you’ll write the rest next.',
          label: 'Title',
          initial: '',
          saveLabel: 'Next',
          onSave: async (v: string) => {
            const result = await createNote(trip.id, { title: v });
            if ('error' in result) return result.error;
            if ('saved' in result) {
              notes.upsert(result.saved);
              router.push(`/trips/${trip.id}/notes/${result.saved.id}?editing=1`);
            }
            return null;
          },
        };
    }
  })();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.ink} />
          </Pressable>
          <Title>Get ready</Title>
          <View style={styles.tabs} accessibilityRole="tablist">
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                aria-selected={tab === t.key}
                onPress={() => {
                  setTab(t.key);
                  setDraft('');
                }}
                style={[styles.tab, tab === t.key && styles.tabOn]}
              >
                <Text style={[styles.tabText, tab === t.key && { color: colors.ink }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {toast ? (
            <Pressable accessibilityLiveRegion="polite" onPress={() => setToast(undefined)} style={styles.toast}>
              <Body style={{ color: '#FFFFFF', flex: 1 }}>{toast}</Body>
              <Feather name="x" size={16} color="#FFFFFF" />
            </Pressable>
          ) : null}

          {tab === 'notes' ? renderNotes() : renderChecklists()}
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionMenu visible={!!menu} title={menu?.text} actions={menu ? lineActions(menu) : []} onClose={() => setMenu(null)} />
      <ActionMenu
        visible={!!listMenu}
        title={listMenu?.title}
        actions={
          listMenu
            ? [
                { icon: 'edit-2', label: 'Rename', onPress: () => setPrompt({ kind: 'rename', list: listMenu }) },
                { icon: 'trash-2', label: 'Delete the list', destructive: true, onPress: () => confirmDeleteList(listMenu) },
              ]
            : []
        }
        onClose={() => setListMenu(null)}
      />
      <ActionMenu
        visible={!!picker}
        title={picker ? (picker.kind === 'assign' ? `Who’s ${kind === 'packing' ? 'bringing' : 'doing'} it?` : 'Due when?') : undefined}
        actions={pickerActions()}
        onClose={() => setPicker(null)}
      />
      <TextPrompt
        visible={!!promptProps}
        title={promptProps?.title ?? ''}
        message={promptProps && 'message' in promptProps ? promptProps.message : undefined}
        label={promptProps?.label ?? ''}
        initial={promptProps?.initial ?? ''}
        saveLabel={promptProps && 'saveLabel' in promptProps ? promptProps.saveLabel : undefined}
        onSave={(v) => promptProps?.onSave(v) ?? Promise.resolve(null)}
        onClose={() => setPrompt(null)}
      />
      <PackingSuggestions
        visible={suggesting}
        trip={trip}
        existing={kindItems.map((i) => i.text)}
        onAdd={async (picked) => say(await lists.addMany('packing', picked.map(({ text, scope }) => ({ text, scope }))))}
        onClose={() => setSuggesting(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, paddingTop: space.sm, gap: space.lg, paddingBottom: space.xxl * 2 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -space.sm },
  center: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: '#ECE7DF' },
  tab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.surface },
  tabText: { fontFamily: fonts.bold, fontSize: 14, color: colors.muted },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#EFEAE2', marginTop: -1 },
  lineMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingLeft: space.md, paddingVertical: space.sm },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  boxRound: { borderRadius: 12 },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  lineText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  lineDone: { color: colors.muted, textDecorationLine: 'line-through' },
  lineMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  count: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingHorizontal: space.sm },
  countText: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  more: { width: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  waiting: { flexBasis: '100%', fontFamily: fonts.body, fontSize: 12, color: colors.muted, paddingLeft: space.md + 24 + space.md, paddingBottom: space.sm, paddingRight: space.md },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  addInput: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  addButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  scopeRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  scopeChip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  scopeChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  scopeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
  newList: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  newListText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent },
  noteCard: { gap: 4, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  noteTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  noteTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
