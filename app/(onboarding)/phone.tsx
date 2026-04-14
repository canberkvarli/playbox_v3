import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useSignUp } from '@clerk/clerk-expo';
import { parsePhoneNumberFromString, AsYouType } from 'libphonenumber-js';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { useDevStore } from '@/stores/devStore';

function digitsOnly(s: string) {
  return s.replace(/\D/g, '');
}

function formatTr(rawDigits: string) {
  // Strip leading 0 if user typed it
  const clean = rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
  const formatter = new AsYouType('TR');
  // libphonenumber wants the national portion
  return formatter.input(clean);
}

function isValidTrMobile(rawDigits: string) {
  const clean = rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
  if (clean.length !== 10) return false;
  if (!clean.startsWith('5')) return false;
  const parsed = parsePhoneNumberFromString('+90' + clean, 'TR');
  return parsed?.isValid() ?? false;
}

export default function Phone() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp, isLoaded } = useSignUp();
  const setBypass = useDevStore((s) => s.setBypass);

  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formatted = useMemo(() => formatTr(raw), [raw]);
  const valid = useMemo(() => isValidTrMobile(raw), [raw]);

  const onChange = (s: string) => {
    setError(null);
    const d = digitsOnly(s).slice(0, 11); // 10 + room for stripped leading 0
    setRaw(d);
  };

  const onContinue = async () => {
    if (!valid || !isLoaded || !signUp || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    await hx.press();

    const clean = raw.startsWith('0') ? raw.slice(1) : raw;
    const phoneNumber = '+90' + clean;

    try {
      await signUp.create({ phoneNumber });
      await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
      router.push({ pathname: '/(onboarding)/otp', params: { phone: phoneNumber } });
    } catch (e) {
      await hx.no();
      setError(t('onb.phone.send_failed'));
    } finally {
      setBusy(false);
    }
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const ctaEnabled = valid && !busy && isLoaded;

  return (
    <View
      className="flex-1 bg-paper px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={palette.ink} />
        </Pressable>
        <OnboardingProgress total={5} active={4} />
      </View>

      <RiseIn delay={0}>
        <View className="mt-12">
          <Text
            className="font-display-x text-ink text-5xl"
            style={{ lineHeight: 48 }}
          >
            {t('onb.phone.title')}
          </Text>
          <Text className="font-sans text-ink/70 text-base leading-6 mt-3">
            {t('onb.phone.sub')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View className="mt-8 flex-row gap-3 items-center">
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 16,
            }}
          >
            <Text className="font-mono text-paper text-lg">+90</Text>
          </View>
          <TextInput
            value={formatted}
            onChangeText={onChange}
            placeholder={t('onb.phone.placeholder')}
            placeholderTextColor={palette.ink + '4d'}
            keyboardType="phone-pad"
            autoFocus
            textContentType="telephoneNumber"
            maxLength={14}
            className="flex-1 bg-paper border border-ink/15 rounded-2xl px-4 py-4 font-mono text-ink text-lg"
            style={{ minHeight: 56 }}
          />
        </View>
      </RiseIn>

      {error ? (
        <Text className="font-sans text-coral text-xs mt-2 ml-1">{error}</Text>
      ) : raw.length >= 10 && !valid ? (
        <Text className="font-sans text-coral text-xs mt-2 ml-1">
          {t('onb.phone.invalid')}
        </Text>
      ) : (
        <Text className="font-sans text-ink/50 text-xs mt-2 ml-1">
          türkiye mobil numarası
        </Text>
      )}

      <View className="flex-1" />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.phone.cta')}
          accessibilityState={{ disabled: !ctaEnabled }}
          onPress={onContinue}
          disabled={!ctaEnabled}
          className={`${ctaEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && ctaEnabled ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${ctaEnabled ? 'text-paper' : 'text-ink/50'} font-semibold text-lg text-center`}
          >
            {busy ? '...' : t('onb.phone.cta')}
          </Text>
        </Pressable>
      </RiseIn>

      {__DEV__ ? (
        <Pressable
          onPress={async () => {
            await hx.tap();
            setBypass(true);
            router.replace('/(tabs)/map');
          }}
          className="mt-4"
          hitSlop={8}
        >
          <Text className="font-mono text-xs text-ink/40 underline text-center">
            dev: admin ol
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
