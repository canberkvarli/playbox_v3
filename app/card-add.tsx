import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useIyzico } from '@/lib/iyzico';
import { usePaymentStore } from '@/stores/paymentStore';
import { RiseIn } from '@/components/RiseIn';
import { useGuardedPress } from '@/hooks/useGuardedPress';

function onlyDigits(s: string) {
  return s.replace(/\D+/g, '');
}

function formatCardNumber(raw: string) {
  const digits = onlyDigits(raw).slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(raw: string) {
  const digits = onlyDigits(raw).slice(0, 4);
  if (digits.length < 3) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function CardAdd() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { registerCard } = useIyzico();
  const setCard = usePaymentStore((s) => s.setCard);

  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const valid = useMemo(() => {
    const digits = onlyDigits(number);
    const exp = onlyDigits(expiry);
    return (
      digits.length >= 15 &&
      digits.length <= 19 &&
      name.trim().length >= 3 &&
      exp.length === 4 &&
      cvc.length >= 3
    );
  }, [number, name, expiry, cvc]);

  const onSubmit = useGuardedPress(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    await hx.tap();

    const exp = onlyDigits(expiry);
    const res = await registerCard({
      cardNumber: onlyDigits(number),
      cardHolderName: name.trim(),
      expireMonth: exp.slice(0, 2),
      expireYear: `20${exp.slice(2, 4)}`,
      cvc,
    });

    setSubmitting(false);

    if (res.ok) {
      setCard({ last4: res.last4, brand: res.brand });
      await hx.yes();
      router.back();
      return;
    }

    await hx.punch();
    Alert.alert(t('card.error.generic_title'), t(`card.error.${res.error}`, {
      defaultValue: t('card.error.generic_sub'),
    }));
  });

  const onClose = useGuardedPress(async () => {
    await hx.tap();
    router.back();
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: palette.paper }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          // Reserve space at the bottom for the fixed kaydet bar so the trust
          // text never sits underneath it.
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 6,
                paddingHorizontal: 4,
              }}
            >
              <Feather name="arrow-left" size={22} color={palette.ink} style={{ marginRight: 6 }} />
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  fontSize: 14,
                }}
              >
                {t('common.back')}
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: palette.ink + '12',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="x" size={20} color={palette.ink} />
            </View>
          </Pressable>
        </View>

        <RiseIn delay={0}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 36,
              lineHeight: 40,
              marginTop: 8,
            }}
          >
            {t('card.add.title')}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 16,
              lineHeight: 22,
              marginTop: 12,
            }}
          >
            {t('card.add.sub')}
          </Text>
        </RiseIn>

        <RiseIn delay={100}>
          <View style={{ marginTop: 28 }}>
            <View style={{ marginBottom: 14 }}>
              <Field
                label={t('card.add.number_label')}
                value={formatCardNumber(number)}
                onChangeText={(v) => setNumber(v)}
                placeholder="4242 4242 4242 4242"
                keyboardType="number-pad"
                autoCorrect={false}
              />
            </View>
            <View style={{ marginBottom: 14 }}>
              <Field
                label={t('card.add.name_label')}
                value={name}
                onChangeText={setName}
                placeholder={t('card.add.name_placeholder')}
                autoCapitalize="characters"
              />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Field
                  label={t('card.add.expiry_label')}
                  value={formatExpiry(expiry)}
                  onChangeText={(v) => setExpiry(v)}
                  placeholder="06/28"
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="CVC"
                  value={cvc}
                  onChangeText={(v) => setCvc(onlyDigits(v).slice(0, 4))}
                  placeholder="123"
                  keyboardType="number-pad"
                  secureTextEntry
                />
              </View>
            </View>
          </View>
        </RiseIn>

        <RiseIn delay={180}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 24,
              backgroundColor: palette.ink + '08',
              borderRadius: 12,
              paddingVertical: 12,
              paddingHorizontal: 14,
            }}
          >
            <Feather name="lock" size={16} color={palette.ink} style={{ marginRight: 10 }} />
            <Text
              style={{
                flex: 1,
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink,
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {t('card.add.trust')}
            </Text>
          </View>
        </RiseIn>
      </ScrollView>

      {/* Fixed bottom kaydet bar — sits above the home indicator, separate
          from the scrollable form so it can never overlap the trust text. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          backgroundColor: palette.paper,
          borderTopWidth: 1,
          borderTopColor: palette.ink + '14',
        }}
      >
        <Pressable
          onPress={onSubmit}
          disabled={!valid || submitting}
          accessibilityRole="button"
          accessibilityLabel={t('card.add.cta')}
          style={({ pressed }) => ({
            opacity: !valid ? 1 : pressed ? 0.92 : 1,
          })}
        >
          <View
            style={{
              backgroundColor: valid ? palette.coral : palette.ink + '22',
              borderRadius: 18,
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: valid ? 0.28 : 0,
              shadowRadius: 14,
              elevation: valid ? 8 : 0,
            }}
          >
            <Feather name="check" size={18} color={palette.paper} style={{ marginRight: 8 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 17,
                letterSpacing: 0.4,
              }}
            >
              {submitting ? t('card.add.cta_loading') : t('card.add.cta')}
            </Text>
          </View>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function Field({ label, style, ...input }: FieldProps) {
  return (
    <View>
      <Text
        style={{
          fontFamily: 'Unbounded_700Bold',
          color: palette.ink,
          fontSize: 12,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label.toLowerCase()}
      </Text>
      <TextInput
        {...input}
        placeholderTextColor={palette.ink + '55'}
        style={[
          {
            borderWidth: 2,
            borderColor: palette.ink + '22',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 14,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 17,
            color: palette.ink,
            backgroundColor: palette.paper,
          },
          style,
        ]}
      />
    </View>
  );
}
