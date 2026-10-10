import Feather from '@expo/vector-icons/Feather';
import {
  DOCUMENT_KINDS,
  DocumentList,
  hasRole,
  TripDocument,
  newId,
  type DocumentKind,
} from '@tagalong/shared';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Title } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import {
  DOCUMENT_KIND_META,
  documentUrl,
  fileSize,
  rejectReason,
  typeLabel,
  uploadDocument,
  type PickedFile,
} from '@/lib/documents';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts, radius, space } from '@/theme';

type Filter = 'all' | DocumentKind;
/** A file on its way up, shown immediately so the upload never looks stuck. */
interface Uploading {
  id: string;
  name: string;
  failed?: boolean;
  retry: () => void;
}

const iconFor = (contentType: string) =>
  contentType.startsWith('image/') ? 'image' : contentType === 'application/pdf' ? 'file-text' : 'file';

/** Every ticket and booking in one place (design: Docs.dc.html). */
export default function DocsTab() {
  const { trip, reload: reloadTrip } = useTrip();
  const [docs, setDocs] = useState<TripDocument[] | null>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tripId = trip?.id;
  const canUpload = !!trip && hasRole(trip.myRole, 'editor');

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 4000);
  };

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const data = await request(`/trips/${tripId}/documents`, { schema: DocumentList });
      setDocs(data.documents.filter((d) => d.status === 'ready'));
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the files');
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  useTripRealtime(tripId, (message) => {
    if (message.kind === 'reconnected') return void load();
    if (message.kind === 'error' && message.code === 'removed') return router.replace('/trips');
    if (message.kind !== 'event') return;

    const { event } = message;
    if (event.type === 'document.upserted') {
      const parsed = TripDocument.safeParse(event.payload);
      if (!parsed.success || parsed.data.status !== 'ready') return;
      setDocs((prev) => {
        if (!prev) return prev;
        const i = prev.findIndex((d) => d.id === parsed.data.id);
        if (i === -1) return [parsed.data, ...prev];
        if (prev[i]!.version > parsed.data.version) return prev;
        return prev.map((d) => (d.id === parsed.data.id ? parsed.data : d));
      });
    } else if (event.type === 'document.deleted') {
      setDocs((prev) => prev?.filter((d) => d.id !== event.entityId) ?? prev);
    } else if (event.type.startsWith('member.')) {
      void reloadTrip();
    }
  });

  const send = useCallback(
    async (file: PickedFile, kind: DocumentKind) => {
      if (!tripId) return;
      const reason = rejectReason(file);
      if (reason) return showToast(reason);

      const id = newId();
      const attempt = async () => {
        setUploading((prev) => [
          { id, name: file.name, retry: attempt },
          ...prev.filter((u) => u.id !== id),
        ]);
        try {
          const saved = await uploadDocument(tripId, file, kind, id);
          setUploading((prev) => prev.filter((u) => u.id !== id));
          setDocs((prev) => [saved, ...(prev ?? []).filter((d) => d.id !== saved.id)]);
        } catch (e) {
          setUploading((prev) =>
            prev.map((u) => (u.id === id ? { ...u, failed: true } : u)),
          );
          showToast(e instanceof ApiError ? e.message : "That file didn't upload");
        }
      };
      await attempt();
    },
    [tripId],
  );

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await send(
      {
        uri: asset.uri,
        name: asset.name,
        contentType: asset.mimeType ?? 'application/octet-stream',
        sizeBytes: asset.size ?? 0,
      },
      'other',
    );
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return showToast('Allow photo access to add a screenshot or a photo of a ticket.');
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await send(
      {
        uri: asset.uri,
        name: asset.fileName ?? `Photo ${new Date().toLocaleDateString()}.jpg`,
        contentType: asset.mimeType ?? 'image/jpeg',
        sizeBytes: asset.fileSize ?? 0,
      },
      'ticket',
    );
  };

  const open = async (doc: TripDocument) => {
    try {
      const { url } = await documentUrl(doc.id);
      await Linking.openURL(url);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not open that file');
    }
  };

  const confirmDelete = (doc: TripDocument) =>
    Alert.alert('Remove this file?', doc.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDocs((prev) => prev?.filter((d) => d.id !== doc.id) ?? prev);
          try {
            await request(`/documents/${doc.id}`, { method: 'DELETE' });
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : 'Could not remove that');
            void load();
          }
        },
      },
    ]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (docs ?? []).filter(
      (d) =>
        (filter === 'all' || d.kind === filter) &&
        (!term || d.name.toLowerCase().includes(term)),
    );
  }, [docs, filter, search]);

  if (!trip) return null;

  const canRemove = (doc: TripDocument) =>
    doc.uploadedBy === trip.myUserId || trip.myRole === 'owner';

  const renderDoc = ({ item: doc }: { item: TripDocument }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${doc.name}, ${typeLabel(doc.contentType)}, ${fileSize(doc.sizeBytes)}`}
      accessibilityHint="Double tap to open"
      onPress={() => open(doc)}
      onLongPress={canRemove(doc) ? () => confirmDelete(doc) : undefined}
      style={styles.card}
    >
      <View style={styles.thumb}>
        <Feather name={iconFor(doc.contentType)} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={2}>
          {doc.name}
        </Text>
        <Body style={{ fontSize: 12 }}>
          {typeLabel(doc.contentType)} · {fileSize(doc.sizeBytes)} · {doc.uploaderName ?? 'Someone'}
        </Body>
      </View>
      <Feather name="chevron-right" size={18} color={colors.lineStrong} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        {/* Reached from the Overview rather than the tab bar, so it needs its own way back. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the overview"
          onPress={() => router.navigate(`/trips/${trip.id}`)}
          style={styles.back}
        >
          <Feather name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Title>Tickets & files</Title>
        <Body style={{ fontSize: 13 }}>Tickets, bookings and anything worth keeping.</Body>

        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search files"
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name"
            placeholderTextColor="#8C867B"
            style={styles.searchInput}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.chips}>
          {(['all', ...DOCUMENT_KINDS] as Filter[]).map((f) => {
            const on = filter === f;
            return (
              <Pressable
                key={f}
                accessibilityRole="tab"
                aria-selected={on}
                onPress={() => setFilter(f)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                  {f === 'all' ? 'All' : DOCUMENT_KIND_META[f].label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
      ) : !docs ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          renderItem={renderDoc}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            uploading.length > 0 ? (
              <View style={{ gap: space.sm, marginBottom: space.sm }}>
                {uploading.map((u) => (
                  <View key={u.id} style={[styles.card, styles.cardUploading]}>
                    <View style={styles.thumb}>
                      {u.failed ? (
                        <Feather name="alert-circle" size={20} color={colors.coralInk} />
                      ) : (
                        <ActivityIndicator color={colors.accent} />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {u.name}
                      </Text>
                      <Body style={{ fontSize: 12 }}>
                        {u.failed ? "Didn't upload" : 'Uploading…'}
                      </Body>
                    </View>
                    {u.failed ? (
                      <Button
                        label="Retry"
                        variant="ghost"
                        onPress={u.retry}
                        style={{ minHeight: 40, paddingHorizontal: space.sm }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="folder" size={28} color={colors.accent} />
              <Body style={{ textAlign: 'center' }}>
                {search || filter !== 'all'
                  ? 'Nothing matches that.'
                  : 'No files yet. Add the boarding passes and tickets so nobody has to dig through their inbox.'}
              </Body>
            </View>
          }
        />
      )}

      {canUpload ? (
        <View style={styles.addBar}>
          <Button
            label="Photo"
            variant="outline"
            onPress={pickPhoto}
            style={{ flex: 1 }}
            icon={<Feather name="image" size={18} color={colors.ink} />}
          />
          <Button
            label="File"
            onPress={pickFile}
            style={{ flex: 1 }}
            icon={<Feather name="upload" size={18} color="#FFFFFF" />}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  back: { width: 44, height: 44, marginLeft: -space.md, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  list: { padding: space.xl, paddingTop: space.md, paddingBottom: 120 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 12, marginBottom: space.sm },
  cardUploading: { borderStyle: 'dashed', marginBottom: 0 },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  addBar: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  toast: { marginHorizontal: space.xl, marginTop: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
});
