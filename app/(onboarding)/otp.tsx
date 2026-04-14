import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useSignUp } from '@clerk/clerk-expo';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';

const RESEND_SECONDS = 60;

export default function Otp() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  const { signUp, setActive, isLoaded } = useSignUp();

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

  // Countdown timer
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  // Auto-verify when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !busy) {
      void verify(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const verify = async (full: string) => {
    if (!isLoaded || !signUp || !setActive) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signUp.attemptPhoneNumberVerification({ code: full });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        await hx.yes();
        router.replace('/(onboarding)/handle');
      } else {
        // status might be missing requirements (e.g. needs more info) — push to handle anyway
        await hx.yes();
        router.replace('/(onboarding)/handle');
      }
    } catch (e) {
      await hx.no();
      setError(t('onb.otp.invalid'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (!isLoaded || !signUp || secondsLeft > 0) return;
    await hx.tap();
    setError(null);
    try {
      await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
      setSecondsLeft(RESEND_SECONDS);
    } catch {
      await hx.no();
      setError(t('onb.otp.resend_failed'));
    }
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

      <View className="mt-12">
        <Text
          className="font-display-x text-ink text-5xl"
          style={{ lineHeight: 48 }}
        >
          {t('onb.otp.title')}
        </Text>
        <Text className="font-sans text-ink/70 text-base leading-6 mt-3">
          {t('onb.otp.sub', { phone: phone ?? '' })}
        </Text>
      </View>

      <Pressable className="mt-10" onPress={focusInput}>
        <View className="flex-row gap-2 justify-center">
          {cells.map((digit, i) => {
            const filled = digit !== '';
            const errored = error !== null;
            const borderColor = errored
              ? palette.coral
              : filled
                ? palette.ink
                : palette.ink + '26';
            const borderWidth = errored || filled ? 2 : 1;
            return (
              <View
                key={i}
                style={{
                  width: 48,
                  height: 56,
                  borderRadius: 12,
                  borderWidth,
                  borderColor,
                  backgroundColor: palette.paper,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text className="font-mono text-ink text-2xl">{digit}</Text>
              </View>
            );
          })}
        </View>
        {/* Hidden input handling all the keyboard work */}
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

      <View className="mt-6 items-center">
        {secondsLeft > 0 ? (
          <Text className="font-mono text-ink/50 text-sm">
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

      {error ? (
        <Text className="font-sans text-coral text-xs text-center mt-4">{error}</Text>
      ) : null}

      <View className="flex-1" />
    </View>
  );
}
