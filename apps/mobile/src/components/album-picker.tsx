import Feather from '@expo/vector-icons/Feather';
import type { Photo } from '@tagalong/shared';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, space } from '@/theme';
import { Body, Button } from './ui';

interface Props {
  visible: boolean;
  /** The album, or null while it loads. */
  photos: Photo[] | null;
  /** What's already picked, which stays picked. */
  selected: string[];
  max: number;
  title: string;
  onDone: (ids: string[]) => void;
  onClose: () => void;
}

/** Pick several photos and videos from the trip's album. */
export function AlbumPicker({ visible, photos, selected, max, title, onDone, onClose }: Props) {
  const [picked, setPicked] = useState<string[]>(selected);
  useEffect(() => {
    if (visible) setPicked(selected);
  }, [visible, selected]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Feather name="x" size={22} color={colors.ink} />
          </Pressable>
        </View>
        {!photos ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space.xl }} />
        ) : photos.length === 0 ? (
          <Body style={{ padding: space.xl }}>The album is empty. Photos added in the Photos tab show up here.</Body>
        ) : (
          <FlatList
            data={photos}
            numColumns={3}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: 2 }}
            renderItem={({ item }) => {
              const on = picked.includes(item.id);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  aria-checked={on}
                  accessibilityLabel={`${item.kind === 'video' ? 'Video' : 'Photo'} by ${item.uploaderName ?? 'someone'}`}
                  onPress={() => toggle(item.id)}
                  style={styles.cell}
                >
                  <Image
                    source={item.thumbUrl ? { uri: item.thumbUrl, cacheKey: `${item.id}-thumb` } : undefined}
                    contentFit="cover"
                    style={{ flex: 1, opacity: on ? 0.7 : 1 }}
                  />
                  {item.kind === 'video' ? (
                    <View style={styles.video}>
                      <Feather name="play" size={12} color={colors.onFill} />
                    </View>
                  ) : null}
                  {on ? (
                    <View style={styles.tick}>
                      <Feather name="check" size={14} color={colors.onFill} />
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
        <View style={styles.footer}>
          <Button label={picked.length ? `Add ${picked.length} of ${max}` : 'Done'} onPress={() => onDone(picked)} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1 / 3, aspectRatio: 1, padding: 2 },
  video: { position: 'absolute', left: 8, bottom: 8, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  tick: { position: 'absolute', right: 8, top: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  footer: { padding: space.xl },
});
