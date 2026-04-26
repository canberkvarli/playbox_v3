import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { supabase } from '@/lib/supabase';

const RESEND_SECONDS = 60;

export default function Otp() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone?: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputRef = useRef<TextInput>(null);

  const cells = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < 6; i++) arr.push(code[i] ?? '');
    return arr;
  }, [code]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  useEffect(() => {
    if (code.length === 6 && !busy) {
      void verify(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (!error || busy) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [error, busy]);

  const verify = async (full: string) => {
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({
        phone,
        token: full,
        type: 'sms',
      });
      if (err || !data.session) throw err ?? new Error('no session');

      await hx.yes();
      // Routing decision lives in one place. KVKK consent gate comes BEFORE
      // the handle step — without consent we can't legally process anything,
      // so it has to be the first stop after OTP.
      const meta = data.user?.user_metadata ?? {};
      const kvkkOk = !!meta.kvkk_accepted_at;
      const onboarded = meta.onboarded === true;
      if (!kvkkOk) router.replace('/(onboarding)/kvkk');
      else if (!onboarded) router.replace('/(onboarding)/handle');
      else router.replace('/(tabs)/map');
    } catch (e) {
      console.warn('[auth] verifyOtp failed', e);
      await hx.no();
      setError(t('onb.otp.invalid'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (secondsLeft > 0 || !phone) return;
    await hx.tap();
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true },
    });
    if (err) {
      console.warn('[auth] resend failed', err);
      await hx.no();
      setError(t('onb.otp.resend_failed'));
      return;
    }
    setSecondsLeft(RESEND_SECONDS);
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  const onChangeText = (s: string) => {
    setError(null);
    const d = s.replace(/\D/g, '').slice(0, 6);
    setCode(d);
  };

  const focusInput = () => inputRef.current?.focus();

  return (
    <View
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
            {t('onb.otp.title')}
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
            {t('onb.otp.sub', { phone: phone ?? '' })}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={140}>
        <Pressable style={{ marginTop: 40 }} onPress={focusInput}>
          <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
            {cells.map((digit, i) => {
              const filled = digit !== '';
              const errored = error !== null;
              const borderColor = errored
                ? palette.coral
                : filled
                ? palette.ink
                : palette.ink + '33';
              const borderWidth = errored || filled ? 2 : 1.5;
              return (
                <View
                  key={i}
                  style={{
                    width: 50,
                    height: 70,
                    borderRadius: 14,
                    borderWidth,
                    borderColor,
                    backgroundColor: palette.paper,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_800ExtraBold',
                      color: palette.ink,
                      fontSize: 30,
                      lineHeight: 34,
                      includeFontPadding: false,
                    }}
                  >
                    {digit}
                  </Text>
                </View>
              );
            })}
          </View>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChangeText}
            autoFocus
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            editable={!busy}
            caretHidden
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              opacity: 0,
              color: 'transparent',
            }}
          />
        </Pressable>
      </RiseIn>

      <RiseIn delay={220}>
        <View style={{ marginTop: 28, alignItems: 'center' }}>
          {secondsLeft > 0 ? (
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: palette.ink,
                fontSize: 14,
                opacity: 0.7,
              }}
            >
              {t('onb.otp.resend_in', { s: secondsLeft })}
            </Text>
          ) : (
            <Pressable onPress={onResend} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.coral,
                  fontSize: 14,
                  textDecorationLine: 'underline',
                }}
              >
                {t('onb.otp.resend')}
              </Text>
            </Pressable>
          )}
        </View>
      </RiseIn>

      {error ? (
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.coral,
            fontSize: 13,
            textAlign: 'center',
            marginTop: 16,
          }}
        >
          {error}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />
    </View>
  );
}
