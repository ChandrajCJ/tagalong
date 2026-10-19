import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radius } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

interface Props {
  icon: IconName;
  /** What it does. Shown as a tooltip and read out by screen readers. */
  label: string;
  onPress: () => void;
  /** Which edge the tooltip lines up with, so it stays on screen. */
  tipAlign?: 'left' | 'right';
  /** "solid" for the main action on a screen (dark), "plain" otherwise. */
  tone?: 'plain' | 'solid';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
}

/**
 * A round icon-only button. Its name shows as a tooltip on hover or keyboard
 * focus (web) and on a long press (phones); screen readers read it as the
 * button's label, so nothing is lost by dropping the visible text.
 */
export function IconButton({ icon, label, onPress, tipAlign = 'right', tone = 'plain', disabled, style, iconSize = 18 }: Props) {
  const [tip, setTip] = useState(false);
  const hideLater = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hideLater.current) clearTimeout(hideLater.current);
    },
    [],
  );
  const showBriefly = () => {
    setTip(true);
    if (hideLater.current) clearTimeout(hideLater.current);
    hideLater.current = setTimeout(() => setTip(false), 1500);
  };
  const solid = tone === 'solid';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={showBriefly}
        onHoverIn={() => setTip(true)}
        onHoverOut={() => setTip(false)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        style={[styles.button, solid ? styles.solid : styles.plain, disabled && { opacity: 0.5 }, style]}
      >
        <Feather name={icon} size={iconSize} color={solid ? '#FFFFFF' : colors.ink} />
      </Pressable>
      {tip ? (
        <View
          pointerEvents="none"
          style={[styles.tooltip, tipAlign === 'left' ? { left: 0 } : { right: 0 }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.tooltipText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 2 },
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  plain: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  solid: { backgroundColor: colors.ink },
  tooltip: {
    position: 'absolute',
    top: '100%',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
  },
  tooltipText: { fontFamily: fonts.medium, fontSize: 12, color: '#FFFFFF' },
});
