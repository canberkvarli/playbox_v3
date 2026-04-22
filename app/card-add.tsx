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

  const onSubmit = async () => {
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
  };

  const onClose = async () => {
    await hx.tap();
    router.back();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: palette.paper }}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Feather name="x" size={24} color={palette.ink} />
          </Pressable>
        </View>

        <RiseIn delay={0}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 32,
              lineHeight: 36,
              marginTop: 8,
            }}
          >
            {t('card.add.title')}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              color: palette.ink + 'B3',
              fontSize: 15,
              lineHeight: 21,
              marginTop: 10,
            }}
          >
            {t('card.add.sub')}
          </Text>
        </RiseIn>

        <RiseIn delay={100}>
          <View style={{ marginTop: 28, gap: 14 }}>
            <Field
              label={t('card.add.number_label')}
              value={formatCardNumber(number)}
              onChangeText={(v) => setNumber(v)}
              placeholder="4242 4242 4242 4242"
              keyboardType="number-pad"
              autoCorrect={false}
            />
            <Field
              label={t('card.add.name_label')}
              value={name}
              onChangeText={setName}
              placeholder={t('card.add.name_placeholder')}
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
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
              gap: 8,
              marginTop: 20,
            }}
          >
            <Feather name="lock" size={14} color={palette.ink + '99'} />
            <Text
              style={{
                flex: 1,
                fontFamily: 'JetBrainsMono_400Regular',
                color: palette.ink + '99',
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              {t('card.add.trust')}
            </Text>
          </View>
        </RiseIn>

        <RiseIn delay={240}>
          <Pressable
            onPress={onSubmit}
            disabled={!valid || submitting}
            accessibilityRole="button"
            accessibilityLabel={t('card.add.cta')}
            style={({ pressed }) => ({
              backgroundColor: !valid ? palette.ink + '22' : palette.ink,
              borderRadius: 20,
              paddingVertical: 20,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              marginTop: 28,
              transform: [{ scale: pressed && valid ? 0.98 : 1 }],
            })}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.paper,
                fontSize: 18,
              }}
            >
              {submitting ? t('card.add.cta_loading') : t('card.add.cta')}
            </Text>
          </Pressable>
        </RiseIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string };

function Field({ label, style, ...input }: FieldProps) {
  return (
    <View>
      <Text
        style={{
          fontFamily: 'JetBrainsMono_400Regular',
          color: palette.ink + '99',
          fontSize: 11,
          letterSpacing: 0.5,
          marginBottom: 6,
        }}
      >
        {label.toLowerCase()}
      </Text>
      <TextInput
        {...input}
        placeholderTextColor={palette.ink + '33'}
        style={[
          {
            borderWidth: 1.5,
            borderColor: palette.ink + '14',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 14,
            fontFamily: 'Inter_400Regular',
            fontSize: 16,
            color: palette.ink,
            backgroundColor: palette.paper,
          },
          style,
        ]}
      />
    </View>
  );
}
