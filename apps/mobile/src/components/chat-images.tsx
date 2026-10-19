import type { ChatImage, LinkPreview } from '@tagalong/shared';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '@/theme';
import { VideoBadge } from './video-badge';

const GRID = 220;
const GAP = 3;

/** A message's photos in the bubble: one large, or a 2×2 grid with "+N" for the rest. */
export function ChatImageGrid({ images, onOpen }: { images: ChatImage[]; onOpen: (id: string) => void }) {
  if (images.length === 1) {
    const [image] = images;
    const ratio = image!.width && image!.height ? Math.min(Math.max(image!.width / image!.height, 0.6), 1.8) : 4 / 3;
    return (
      <Tile image={image!} width={GRID} height={GRID / ratio} onOpen={onOpen} label="Open photo" />
    );
  }
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  const cell = (GRID - GAP) / 2;
  return (
    <View style={styles.grid}>
      {shown.map((image, i) => (
        <Tile
          key={image.id}
          image={image}
          width={cell}
          // Two photos sit side by side; three or four make a square grid.
          height={images.length === 2 ? GRID * 0.75 : cell}
          onOpen={onOpen}
          label={`Open photo ${i + 1} of ${images.length}`}
          more={i === shown.length - 1 && extra > 0 ? extra : 0}
        />
      ))}
    </View>
  );
}

function Tile(props: { image: ChatImage; width: number; height: number; onOpen: (id: string) => void; label: string; more?: number }) {
  const { image, width, height, more = 0 } = props;
  const uri = image.thumbUrl ?? image.url;
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={props.label} onPress={() => props.onOpen(image.id)}>
      <Image
        // Cached by id, not by URL: the signed link changes every time it's fetched.
        source={uri ? { uri, cacheKey: `${image.id}-${image.thumbUrl ? 'thumb' : 'full'}` } : undefined}
        contentFit="cover"
        transition={120}
        style={[styles.tile, { width, height }]}
      />
      {image.kind === 'video' && more === 0 ? <VideoBadge durationMs={image.durationMs} /> : null}
      {more > 0 ? (
        <View style={styles.more}>
          <Text style={styles.moreText}>+{more}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Photos and videos picked but not sent yet, still on this phone: shown while they upload. */
export function PendingImages({ items }: { items: { uri: string; video: boolean }[] }) {
  const cell = { width: (GRID - GAP) / 2, height: (GRID - GAP) / 2 };
  return (
    <View style={styles.grid}>
      {items.slice(0, 4).map(({ uri, video }) =>
        // A video on the phone has no picture to show until its poster is made: a dark tile says what it is.
        video ? (
          <View key={uri} style={[styles.tile, cell, styles.pendingVideo]}>
            <Feather name="video" size={22} color={colors.onPhoto} />
          </View>
        ) : (
          <Image key={uri} source={{ uri }} contentFit="cover" style={[styles.tile, cell, { opacity: 0.6 }]} />
        ),
      )}
    </View>
  );
}

/** The card under a message with a link: picture, title and site. */
export function LinkPreviewCard({ preview, mine }: { preview: LinkPreview; mine: boolean }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${preview.title ?? preview.siteName ?? 'link'}`}
      onPress={() => void Linking.openURL(preview.url)}
      style={[styles.card, mine && styles.cardMine]}
    >
      {preview.image ? <Image source={{ uri: preview.image }} contentFit="cover" style={styles.cardImage} /> : null}
      <View style={styles.cardText}>
        {preview.siteName ? (
          <Text style={[styles.site, mine && { color: colors.onAccentMuted }]} numberOfLines={1}>
            {preview.siteName}
          </Text>
        ) : null}
        {preview.title ? (
          <Text style={[styles.title, mine && { color: colors.onFill }]} numberOfLines={2}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text style={[styles.description, mine && { color: colors.onAccentMuted }]} numberOfLines={2}>
            {preview.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { width: GRID, flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 12, backgroundColor: colors.line },
  pendingVideo: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mediaPlaceholder },
  more: { ...StyleSheet.absoluteFill, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  moreText: { fontFamily: fonts.bold, fontSize: 22, color: colors.onPhoto },
  card: { width: GRID, marginTop: 6, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  cardMine: { backgroundColor: colors.onFillWash, borderColor: 'transparent' },
  cardImage: { width: GRID, height: GRID / 1.91 },
  cardText: { padding: 8, gap: 2 },
  site: { fontFamily: fonts.bold, fontSize: 11, color: colors.muted, textTransform: 'uppercase' },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  description: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
