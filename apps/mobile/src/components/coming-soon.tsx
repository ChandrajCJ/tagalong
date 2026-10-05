import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from '@/theme';
import { Body, Title } from './ui';

type IconName = React.ComponentProps<typeof Feather>['name'];

/** Placeholder for a trip tab that's built in a later step. */
export function ComingSoon({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.icon}>
          <Feather name={icon} size={28} color={colors.accent} />
        </View>
        <Title style={styles.text}>{title}</Title>
        <Body style={styles.text}>{body}</Body>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  text: { textAlign: 'center', fontSize: 24 },
});
