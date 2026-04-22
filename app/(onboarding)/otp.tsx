import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { supabase } from '@/lib/supabase';

const RESEND_SECONDS = 60;

export default function Otp() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
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

  // Re-focus the hidden input after a verify error so the keyboard pops back up
  // immediately instead of waiting for another tap. Deferred via rAF so React
  // has time to re-render with editable=true (busy flipped back off in finally).
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
      // Users who finished the name step carry `onboarded: true`. Everyone else
      // lands on the optional name screen (which they can skip).
      const onboarded = data.user?.user_metadata?.onboarded === true;
      router.replace(onboarded ? '/(tabs)/map' : '/(onboarding)/handle');
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
            {t('onb.otp.title')}
          </Text>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base leading-6 mt-3">
            {t('onb.otp.sub', { phone: phone ?? '' })}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={140}>
       <Pressable className="mt-12" onPress={focusInput}>
        <View className="flex-row justify-center" style={{ gap: 10 }}>
          {cells.map((digit, i) => {
            const filled = digit !== '';
            const errored = error !== null;
            const borderColor = errored
              ? palette.coral
              : filled
                ? theme.fg
                : theme.fg + '26';
            const borderWidth = errored || filled ? 2 : 1.5;
            return (
              <View
                key={i}
                style={{
                  width: 52,
                  height: 72,
                  borderRadius: 16,
                  borderWidth,
                  borderColor,
                  backgroundColor: theme.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  className="font-mono text-ink dark:text-paper"
                  style={{ fontSize: 36, lineHeight: 40, includeFontPadding: false }}
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
        <View className="mt-8 items-center">
          {secondsLeft > 0 ? (
            <Text className="font-mono text-ink/50 dark:text-paper/50 text-sm">
              {t('onb.otp.resend_in', { s: secondsLeft })}
            </Text>
          ) : (
            <Pressable onPress={onResend} hitSlop={8}>
              <Text className="font-mono text-coral text-sm font-medium underline">
                {t('onb.otp.resend')}
              </Text>
            </Pressable>
          )}
        </View>
      </RiseIn>

      {error ? (
        <Text className="font-sans text-coral text-xs text-center mt-4">{error}</Text>
      ) : null}

      <View className="flex-1" />
    </View>
  );
}
