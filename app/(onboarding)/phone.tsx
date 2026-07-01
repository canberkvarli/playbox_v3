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
import { Button } from '@/components/ui';
import { useDevStore } from '@/stores/devStore';
import { supabase } from '@/lib/supabase';
import { useGuardedPress } from '@/hooks/useGuardedPress';

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

  const onContinue = useGuardedPress(async () => {
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
  });

  const onBack = useGuardedPress(async () => {
    await hx.tap();
    router.back();
  });

  const ctaEnabled = valid && !busy;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      style={{
        flex: 1,
        backgroundColor: palette.bg,
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
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.fg} />
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
              color: palette.muted,
              fontSize: 16,
              lineHeight: 22,
              marginTop: 12,
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
              backgroundColor: palette.surfaceAlt,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: palette.border,
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
                color: palette.volt,
                fontFamily: 'JetBrainsMono_500Medium',
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
            placeholderTextColor={palette.muted}
            keyboardType="phone-pad"
            autoFocus
            textContentType="telephoneNumber"
            maxLength={14}
            style={{
              flex: 1,
              backgroundColor: palette.surfaceAlt,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 16,
              paddingHorizontal: 18,
              fontFamily: 'JetBrainsMono_500Medium',
              color: palette.fg,
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
            color: palette.danger,
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
            color: palette.danger,
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
            color: palette.muted,
            fontSize: 12,
            marginTop: 8,
            marginLeft: 4,
            fontFamily: 'Inter_600SemiBold',
          }}
        >
          türkiye mobil numarası
        </Text>
      )}

      <View style={{ flex: 1 }} />

      <RiseIn delay={220} style={{ marginBottom: 16 }}>
        <Button
          label={t('onb.phone.cta')}
          onPress={onContinue}
          disabled={!ctaEnabled}
          loading={busy}
          full
        />
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
              color: palette.muted,
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
