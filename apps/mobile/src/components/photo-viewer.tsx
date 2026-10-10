import Feather from '@expo/vector-icons/Feather';
import type { Photo } from '@tagalong/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { savePhotos } from '@/lib/photos';
import { fonts, space } from '@/theme';

interface Props {
  photos: Photo[];
  /** The photo to open on, or null when closed. */
  startId: string | null;
  canDelete: (photo: Photo) => boolean;
  onDelete: (photo: Photo) => Promise<void>;
  /** Hearts it, or takes the heart back. */
  onFavourite: (photo: Photo) => void;
  onClose: () => void;
}

/** "Sat 13 Jun, 18:30" from a camera's local time. */
const takenLabel = (takenAt: string | null) => {
  if (!takenAt) return 'Date unknown';
  const [date, time] = takenAt.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  // Built from parts and shown in UTC, so the phone's own zone can't shift it.
  const label = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  return `${label}, ${time!.slice(0, 5)}`;
};

/** Full screen, swipe between photos (design: PhotoViewer.dc.html). */
export function PhotoViewer({ photos, startId, canDelete, onDelete, onFavourite, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const startIndex = Math.max(0, photos.findIndex((p) => p.id === startId));
  const [index, setIndex] = useState(startIndex);
  const [saveLabel, setSaveLabel] = useState('Save');
  const list = useRef<FlatList<Photo>>(null);

  useEffect(() => {
    if (startId !== null) setIndex(startIndex);
  }, [startId, startIndex]);

  /*
   * Which photo is on screen decides what Share and Delete act on, so it must
   * be right. Neither a swipe's end event nor the list's visibility callback
   * fires in a browser, which left Delete aimed at the photo you started on
   * while showing another. A plain scroll event fires everywhere.
   */
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const shown = Math.round(e.nativeEvent.contentOffset.x / width);
    const clamped = Math.min(Math.max(shown, 0), photos.length - 1);
    setIndex((prev) => (prev === clamped ? prev : clamped));
  };

  const current = photos[index];
  if (startId === null) return null;

  const share = async () => {
    if (!current?.url) return;
    if (Platform.OS === 'web') return void Linking.openURL(current.url);
    // The link is signed and short-lived, which suits a one-off share.
    await Share.share({ url: current.url, message: current.url });
  };

  const confirmDelete = () => {
    if (!current) return;
    Alert.alert('Delete this photo?', 'It goes for everyone on the trip.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await onDelete(current);
          if (photos.length <= 1) onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.screen}>
        <FlatList
          ref={list}
          data={photos}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <View style={{ width, height, justifyContent: 'center' }}>
              <Image
                accessibilityLabel={`Photo by ${item.uploaderName ?? 'someone'}, ${takenLabel(item.takenAt)}`}
                // Cached by id, not by URL: the signed link changes every time it's fetched.
                source={item.url ? { uri: item.url, cacheKey: `${item.id}-full` } : undefined}
                placeholder={item.thumbUrl ? { uri: item.thumbUrl, cacheKey: `${item.id}-thumb` } : undefined}
                contentFit="contain"
                transition={150}
                style={{ width, height }}
              />
            </View>
          )}
        />

        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}>
            <Feather name="x" size={24} color="#FFFFFF" />
          </Pressable>
          {current ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.who} numberOfLines={1}>
                {current.uploaderName ?? 'Someone'}
              </Text>
              <Text style={styles.when}>{takenLabel(current.takenAt)}</Text>
            </View>
          ) : null}
          <Text style={styles.count}>
            {index + 1} / {photos.length}
          </Text>
        </SafeAreaView>

        <SafeAreaView edges={['bottom']} style={styles.bottomBar} pointerEvents="box-none">
          {current ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={current.favourited ? 'Remove your heart' : 'Heart this photo'}
              aria-checked={current.favourited}
              onPress={() => onFavourite(current)}
              style={styles.action}
            >
              <Feather name="heart" size={20} color={current.favourited ? '#FF6B6B' : '#FFFFFF'} />
              <Text style={styles.actionText}>
                {current.favourites > 0 ? current.favourites : 'Heart'}
              </Text>
            </Pressable>
          ) : null}
          {current ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save photo to your phone"
              onPress={async () => {
                setSaveLabel('Saving…');
                const { saved } = await savePhotos([current]);
                setSaveLabel(saved ? 'Saved' : 'Couldn’t save');
                setTimeout(() => setSaveLabel('Save'), 2000);
              }}
              style={styles.action}
            >
              <Feather name={saveLabel === 'Saved' ? 'check' : 'download'} size={20} color="#FFFFFF" />
              <Text style={styles.actionText}>{saveLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Share photo" onPress={share} style={styles.action}>
            <Feather name="share" size={20} color="#FFFFFF" />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
          {current && canDelete(current) ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Delete photo" onPress={confirmDelete} style={styles.action}>
              <Feather name="trash-2" size={20} color="#FFFFFF" />
              <Text style={styles.actionText}>Delete</Text>
            </Pressable>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.sm, backgroundColor: 'rgba(0,0,0,0.35)' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  who: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  when: { fontFamily: fonts.body, fontSize: 12, color: '#D9D9D9' },
  count: { fontFamily: fonts.medium, fontSize: 13, color: '#D9D9D9', paddingHorizontal: space.md },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: space.xxl, paddingTop: space.md, backgroundColor: 'rgba(0,0,0,0.35)' },
  action: { alignItems: 'center', gap: 4, minWidth: 64, minHeight: 44, paddingVertical: space.xs },
  actionText: { fontFamily: fonts.medium, fontSize: 12, color: '#FFFFFF' },
});
