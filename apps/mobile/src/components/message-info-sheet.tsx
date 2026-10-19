import Feather from '@expo/vector-icons/Feather';
import { MessageInfo } from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { request } from '@/lib/api';
import { colors, fonts, space } from '@/theme';
import { Body } from './ui';

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return today ? `Today, ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
};

/** Long-press → Info on one of my messages: who has read it, who has it, and who doesn't yet. */
export function MessageInfoSheet({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const [info, setInfo] = useState<MessageInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!messageId) return;
    setInfo(null);
    setError(false);
    request(`/messages/${messageId}/info`, { schema: MessageInfo })
      .then(setInfo)
      .catch(() => setError(true));
  }, [messageId]);

  return (
    <Modal visible={!!messageId} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose}>
        <Pressable style={{ width: '100%' }} onPress={() => {}}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.title}>
              Message info
            </Text>
            {error ? (
              <Body>Couldn’t load who has seen it. Try again.</Body>
            ) : !info ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.lg }}>
                {info.readsShown ? (
                  <Section icon="check-circle" tint={colors.accent} title="Read by" empty="Nobody yet">
                    {info.readBy.map((p) => (
                      <Row key={p.userId} name={p.displayName} detail={when(p.at)} />
                    ))}
                  </Section>
                ) : (
                  <Body style={{ fontSize: 13 }}>
                    Your read receipts are off, so you can’t see who has read it. Turn them on in Profile.
                  </Body>
                )}
                <Section icon="check" tint={colors.muted} title="Delivered to" empty="Nobody waiting to read it">
                  {info.deliveredTo.map((p) => (
                    <Row key={p.userId} name={p.displayName} detail={p.at ? when(p.at) : null} />
                  ))}
                </Section>
                {info.notDelivered.length > 0 ? (
                  <Section icon="clock" tint={colors.muted} title="Not delivered yet" empty="">
                    {info.notDelivered.map((p) => (
                      <Row key={p.userId} name={p.displayName} detail="Their phone hasn’t got it yet" />
                    ))}
                  </Section>
                ) : null}
              </ScrollView>
            )}
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section(props: {
  icon: React.ComponentProps<typeof Feather>['name'];
  tint: string;
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.sectionHead}>
        <Feather name={props.icon} size={15} color={props.tint} />
        <Text style={styles.sectionTitle}>{props.title}</Text>
      </View>
      {props.children.length > 0 ? props.children : <Body style={{ fontSize: 13 }}>{props.empty}</Body>}
    </View>
  );
}

function Row({ name, detail }: { name: string; detail: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.name}>{name}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.xl, gap: space.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
