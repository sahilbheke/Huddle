import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
};

export function Button({ label, onPress, kind = 'primary', disabled, busy }: ButtonProps) {
  const theme = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.accent : theme.backgroundElement,
          borderColor: primary ? theme.accent : theme.border,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}>
      {busy ? (
        <ActivityIndicator color={primary ? theme.accentText : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: primary ? theme.accentText : theme.text, fontSize: 16 }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
        {...props}
      />
    </>
  );
}

export function ErrorText({ children }: { children: string }) {
  const theme = useTheme();
  if (!children) return null;
  return (
    <ThemedText type="small" style={{ color: theme.danger }} accessibilityRole="alert">
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    fontSize: 18,
  },
});

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const theme = useTheme();
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  const btn = (d: number, glyph: string, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => step(d)}
      disabled={d < 0 ? value <= min : value >= max}
      style={[stepperStyles.btn, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <ThemedText type="smallBold" style={{ fontSize: 18 }}>
        {glyph}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={stepperStyles.row}>
      <ThemedText style={stepperStyles.label}>{label}</ThemedText>
      {btn(-1, '−', `Less ${label.toLowerCase()}`)}
      <ThemedText type="smallBold" style={stepperStyles.value} accessibilityLiveRegion="polite">
        {format ? format(value) : String(value)}
      </ThemedText>
      {btn(1, '+', `More ${label.toLowerCase()}`)}
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1 },
  btn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 40, textAlign: 'center', fontSize: 16 },
});
