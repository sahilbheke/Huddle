import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorText, Field } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Builds an E.164 number like +919812345678 from the two inputs. */
function toE164(code: string, number: string) {
  const digits = (code + number).replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export default function SignInScreen() {
  const [code, setCode] = useState('+91');
  const [number, setNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const phone = toE164(code, number);

  async function sendCode() {
    setError('');
    if (number.replace(/\D/g, '').length < 6) {
      setError('Enter your full mobile number.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (err) setError(err.message);
    else setSentTo(phone);
  }

  async function verify() {
    if (!sentTo) return;
    setError('');
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ phone: sentTo, token: otp.trim(), type: 'sms' });
    setBusy(false);
    // On success the auth listener switches the app to the next screen.
    if (err) setError(err.message);
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.body}>
          <View style={styles.hero}>
            <ThemedText type="subtitle">Huddle</ThemedText>
            <ThemedText themeColor="textSecondary">
              Keep your people moving together. Sign in with your phone number to find friends from your contacts.
            </ThemedText>
          </View>

          {!sentTo ? (
            <View style={styles.form}>
              <View style={styles.row}>
                <View style={styles.code}>
                  <Field label="Code" value={code} onChangeText={setCode} keyboardType="phone-pad" autoComplete="tel-country-code" />
                </View>
                <View style={styles.grow}>
                  <Field
                    label="Mobile number"
                    value={number}
                    onChangeText={setNumber}
                    keyboardType="phone-pad"
                    autoComplete="tel-national"
                    textContentType="telephoneNumber"
                    placeholder="98123 45678"
                    returnKeyType="send"
                    onSubmitEditing={sendCode}
                  />
                </View>
              </View>
              <ErrorText>{error}</ErrorText>
              <Button label="Send code" onPress={sendCode} busy={busy} />
            </View>
          ) : (
            <View style={styles.form}>
              <ThemedText themeColor="textSecondary">We sent a 6-digit code to {sentTo}.</ThemedText>
              <Field
                label="Code from SMS"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                maxLength={6}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={verify}
              />
              <ErrorText>{error}</ErrorText>
              <Button label="Verify and continue" onPress={verify} busy={busy} disabled={otp.trim().length < 6} />
              <Button
                label="Use a different number"
                kind="secondary"
                onPress={() => {
                  setSentTo(null);
                  setOtp('');
                  setError('');
                }}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  hero: { gap: Spacing.two },
  form: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  code: { width: 88, gap: Spacing.two },
  grow: { flex: 1, gap: Spacing.two },
});
