import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { parsePhoneNumberFromString, AsYouType } from 'libphonenumber-js';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
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
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.ink + '0d',
              borderWidth: 1,
              borderColor: palette.ink + '14',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.ink} />
          </View>
        </Pressable>
        <OnboardingProgress total={5} active={4} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 40 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 44,
              lineHeight: 48,
            }}
          >
            {t('onb.phone.title')}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 16,
              lineHeight: 22,
              marginTop: 12,
              opacity: 0.85,
            }}
          >
            {t('onb.phone.sub')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View style={{ marginTop: 32, flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: 16,
              paddingHorizontal: 18,
              paddingVertical: 22,
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 84,
              minHeight: 70,
              marginRight: 12,
            }}
          >
            <Text
              style={{
                color: palette.paper,
                fontFamily: 'Unbounded_800ExtraBold',
                fontSize: 22,
                letterSpacing: 0.5,
              }}
            >
              +90
            </Text>
          </View>
          <TextInput
            value={formatted}
            onChangeText={onChange}
            placeholder={t('onb.phone.placeholder')}
            placeholderTextColor={palette.ink + '66'}
            keyboardType="phone-pad"
            autoFocus
            textContentType="telephoneNumber"
            maxLength={14}
            style={{
              flex: 1,
              backgroundColor: palette.paper,
              borderWidth: 2,
              borderColor: palette.ink + '22',
              borderRadius: 16,
              paddingHorizontal: 18,
              fontFamily: 'JetBrainsMono_500Medium',
              color: palette.ink,
              minHeight: 70,
              fontSize: 22,
              letterSpacing: 0.5,
            }}
          />
        </View>
      </RiseIn>

      {error ? (
        <Text
          style={{
            color: palette.coral,
            fontSize: 12,
            marginTop: 8,
            marginLeft: 4,
            fontFamily: 'Unbounded_700Bold',
          }}
        >
          {error}
        </Text>
      ) : raw.length >= 10 && !valid ? (
        <Text
          style={{
            color: palette.coral,
            fontSize: 12,
            marginTop: 8,
            marginLeft: 4,
            fontFamily: 'Unbounded_700Bold',
          }}
        >
          {t('onb.phone.invalid')}
        </Text>
      ) : (
        <Text
          style={{
            color: palette.ink,
            fontSize: 12,
            marginTop: 8,
            marginLeft: 4,
            fontFamily: 'Inter_600SemiBold',
            opacity: 0.7,
          }}
        >
          türkiye mobil numarası
        </Text>
      )}

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.phone.cta')}
          accessibilityState={{ disabled: !ctaEnabled }}
          onPress={onContinue}
          disabled={!ctaEnabled}
          style={({ pressed }) => ({
            opacity: !ctaEnabled ? 0.45 : pressed ? 0.92 : 1,
          })}
        >
          <View
            style={{
              backgroundColor: ctaEnabled ? palette.coral : palette.ink + '33',
              borderRadius: 20,
              paddingVertical: 20,
              alignItems: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: ctaEnabled ? 0.32 : 0,
              shadowRadius: 18,
              elevation: ctaEnabled ? 12 : 0,
            }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 18,
                letterSpacing: 0.5,
              }}
            >
              {busy ? '...' : t('onb.phone.cta')}
            </Text>
          </View>
        </Pressable>
      </RiseIn>

      {__DEV__ ? (
        <Pressable
          onPress={async () => {
            await hx.tap();
            setBypass(true);
            router.replace('/(tabs)/map');
          }}
          style={{ marginTop: 14 }}
          hitSlop={8}
        >
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 12,
              color: palette.ink,
              opacity: 0.55,
              textDecorationLine: 'underline',
              textAlign: 'center',
            }}
          >
            dev: admin ol
          </Text>
        </Pressable>
      ) : null}
    </KeyboardAvoidingView>
  );
}
