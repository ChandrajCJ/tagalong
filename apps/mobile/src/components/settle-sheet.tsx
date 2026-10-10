import Feather from '@expo/vector-icons/Feather';
import {
  amountText,
  parseAmount,
  SETTLEMENT_METHODS,
  type SettlementMethod,
  type Transfer,
} from '@tagalong/shared';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SETTLEMENT_LABELS } from '@/lib/money';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button, Field, Label } from './ui';

export type PendingPayment = Transfer & {
  /** Set after the UPI app was opened: the money may already have gone. */
  viaUpi?: boolean;
};

interface Props {
  /** The payment to record, usually one the app suggested. */
  transfer: PendingPayment | null;
  currency: string;
  nameOf: (userId: string) => string;
  onSave: (payment: Transfer & { method: SettlementMethod; note: string | null }) => Promise<string | null>;
  onClose: () => void;
}

/** "Sam paid you €52": records a payment, which may be less than what's owed. */
export function SettleSheet({ transfer, currency, nameOf, onSave, onClose }: Props) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SettlementMethod>('transfer');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!transfer) return;
    setAmount(amountText(transfer.amountMinor, currency));
    setMethod('transfer');
    setError(undefined);
  }, [transfer, currency]);

  if (!transfer) return null;

  const save = async () => {
    const amountMinor = parseAmount(amount, currency);
    if (!amountMinor) return setError(`Enter an amount like ${amountText(1250, currency)}`);
    setBusy(true);
    const problem = await onSave({
      fromUser: transfer.fromUser,
      toUser: transfer.toUser,
      amountMinor,
      method,
      note: transfer.viaUpi && method === 'transfer' ? 'UPI' : null,
    });
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            Record a payment
          </Text>
          <View style={styles.people}>
            <Text style={styles.person}>{nameOf(transfer.fromUser)}</Text>
            <Feather name="arrow-right" size={18} color={colors.accent} />
            <Text style={styles.person}>{nameOf(transfer.toUser)}</Text>
          </View>
          <Body style={{ fontSize: 13 }}>
            {transfer.viaUpi
              ? 'Did the payment go through in your UPI app? Mark it as paid here so everyone’s balances update. Tagalong can’t see your bank, so it relies on you.'
              : 'Record it once the money has actually changed hands. A part payment is fine too.'}
          </Body>

          <Field
            label={`Amount (${currency})`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            error={error}
          />

          <View style={{ gap: space.sm }}>
            <Label>How</Label>
            <View style={styles.chips}>
              {SETTLEMENT_METHODS.map((m) => {
                const on = method === m;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="radio"
                    aria-checked={on}
                    onPress={() => setMethod(m)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>{SETTLEMENT_LABELS[m]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Button label="Mark as paid" onPress={save} loading={busy} />
          <Button label="Cancel" variant="outline" onPress={onClose} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,27,25,0.4)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, gap: space.md },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  person: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
});
