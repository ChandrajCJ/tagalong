import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, space } from '@/theme';
import { PlaceField, type PickedPlace } from './place-field';
import { Body } from './ui';

interface Props {
  visible: boolean;
  tripId: string;
  /** What to look for first: the item's place, or its title. */
  query: string;
  onPick: (place: PickedPlace) => Promise<void>;
  onClose: () => void;
}

/** "Find on map" for a plan item added before it had a spot: the place search, prefilled. */
export function FindOnMapSheet({ visible, tripId, query, onPick, onClose }: Props) {
  const [text, setText] = useState(query);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (visible) {
      setText(query);
      setError(undefined);
    }
  }, [visible, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              Find on map
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Feather name="x" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Body style={{ fontSize: 13 }}>
              Pick the right place to see it on the trip map, with travel times to the stops either side.
            </Body>
            <PlaceField
              label="Place"
              value={text}
              picked={false}
              tripId={tripId}
              onChangeText={setText}
              onPick={async (place) => {
                try {
                  await onPick(place);
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not save that');
                }
              }}
              searchNow
              autoFocus
            />
            {error ? <Body style={{ color: colors.danger }}>{error}</Body> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.lg },
});
