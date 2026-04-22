import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { parsePhoneNumberFromString, AsYouType } from 'libphonenumber-js';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { useDevStore } from '@/stores/devStore';
import { supabase } from '@/lib/supabase';

function digitsOnly(s: string) {
  return s.replace(/\D/g, '');
}

function formatTr(rawDigits: string) {
  const clean = rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
  const formatter = new AsYouType('TR');
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
  const theme = useTheme();
  const setBypass = useDevStore((s) => s.setBypass);

  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formatted = useMemo(() => formatTr(raw), [raw]);
  const valid = useMemo(() => isValidTrMobile(raw), [raw]);

  const onChange = (s: string) => {
    setError(null);
    const d = digitsOnly(s).slice(0, 11);
    setRaw(d);
  };

  const onContinue = async () => {
    if (!valid || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    await hx.press();

    const clean = raw.startsWith('0') ? raw.slice(1) : raw;
    const phoneNumber = '+90' + clean;

    // Supabase handles sign-in and sign-up in one call: if the user exists,
    // it sends a login OTP; if not, it creates the account and sends a signup OTP.
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: phoneNumber,
      options: { shouldCreateUser: true },
    });

    if (err) {
      console.warn('[auth] signInWithOtp failed', err);
      await hx.no();
      setError(t('onb.phone.send_failed'));
      setBusy(false);
      return;
    }

    router.push({ pathname: '/(onboarding)/otp', params: { phone: phoneNumber } });
    setBusy(false);
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const ctaEnabled = valid && !busy;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      className="flex-1 bg-paper dark:bg-ink px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={theme.fg} />
        </Pressable>
        <OnboardingProgress total={5} active={4} />
      </View>

      <RiseIn delay={0}>
        <View className="mt-12">
          <Text
            className="font-display-x text-ink dark:text-paper text-5xl"
            style={{ lineHeight: 48 }}
          >
            {t('onb.phone.title')}
          </Text>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base leading-6 mt-3">
            {t('onb.phone.sub')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View className="mt-10 flex-row gap-3 items-center">
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: 18,
              paddingHorizontal: 18,
              paddingVertical: 22,
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 84,
              minHeight: 76,
            }}
          >
            <Text
              style={{
                color: palette.paper,
                fontFamily: 'JetBrainsMono_400Regular',
                fontSize: 24,
                letterSpacing: 0.5,
                fontWeight: '600',
              }}
            >
              +90
            </Text>
          </View>
          <TextInput
            value={formatted}
            onChangeText={onChange}
            placeholder={t('onb.phone.placeholder')}
            placeholderTextColor={theme.fg + '4d'}
            keyboardType="phone-pad"
            autoFocus
            textContentType="telephoneNumber"
            maxLength={14}
            className="flex-1 bg-paper dark:bg-ink border border-ink/15 dark:border-paper/15 rounded-2xl px-5 font-mono text-ink dark:text-paper"
            style={{ minHeight: 76, fontSize: 26, letterSpacing: 0.5 }}
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
        <Text className="font-sans text-ink/50 dark:text-paper/50 text-xs mt-2 ml-1">
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
          className={`${ctaEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20 dark:bg-paper/20'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && ctaEnabled ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${ctaEnabled ? 'text-paper' : 'text-ink/50 dark:text-paper/50'} font-semibold text-lg text-center`}
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
          <Text className="font-mono text-xs text-ink/40 dark:text-paper/40 underline text-center">
            dev: admin ol
          </Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}
