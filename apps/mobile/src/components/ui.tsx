import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, space } from '@/theme';

type Variant = 'primary' | 'dark' | 'light' | 'outline' | 'outlineLight' | 'ghost';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  loading?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

const variantStyles: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.accent, fg: '#FFFFFF' },
  dark: { bg: colors.ink, fg: '#FFFFFF' },
  light: { bg: '#FFFFFF', fg: colors.ink },
  outline: { bg: 'transparent', fg: colors.ink, border: colors.lineStrong },
  outlineLight: { bg: 'transparent', fg: '#FFFFFF', border: '#FFFFFF' },
  ghost: { bg: 'transparent', fg: colors.accent },
};

export function Button({ label, variant = 'primary', loading, disabled, style, icon, ...rest }: ButtonProps) {
  const v = variantStyles[variant];
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={!!disabled || !!loading}
      aria-busy={!!loading}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg, borderWidth: v.border ? 1.5 : 0 },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        disabled && { opacity: 0.5 },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon}
          <Text style={[styles.buttonLabel, { color: v.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, ...rest },
  ref,
) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor="#8C867B"
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

export function Title({ style, ...rest }: TextProps) {
  return <Text accessibilityRole="header" style={[styles.title, style]} {...rest} />;
}

export function Body({ style, ...rest }: TextProps) {
  return <Text style={[styles.body, style]} {...rest} />;
}

export function Label({ style, ...rest }: TextProps) {
  return <Text style={[styles.label, style]} {...rest} />;
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: size * 0.42 }}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 16 },
  label: { fontFamily: fonts.bold, fontSize: 13, color: colors.muted },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
});
