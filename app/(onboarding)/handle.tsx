import { useState } from 'react';
import { Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';

// Deterministic unique handle derived from the user's Supabase UUID.
// UUIDs are globally unique → the last 6 hex chars are effectively collision-free.
function defaultUsername(userId: string): string {
  return `oyuncu_${userId.slice(-6)}`;
}

export default function Handle() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user, loading } = useAuthSession();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();
  const initial = trimmedName.charAt(0).toUpperCase() || '?';

  const finish = async (withName: boolean) => {
    if (!user || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    await hx.press();

    const meta: Record<string, string | boolean> = {
      username: defaultUsername(user.id),
      onboarded: true,
    };
    if (withName && trimmedName) meta.name = trimmedName;

    const { error: err } = await supabase.auth.updateUser({ data: meta });
    if (err) {
      console.warn('[auth] updateUser failed', err);
      await hx.no();
      setError(err.message ?? t('onb.handle.save_failed'));
      setBusy(false);
      return;
    }
    await hx.yes();
    router.replace('/(tabs)/map');
    setBusy(false);
  };

  const onSubmit = () => finish(true);
  const onSkip = () => finish(false);

  const primaryEnabled = !busy && !loading;

  return (
    <View
      className="flex-1 bg-paper dark:bg-ink px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.mauve,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="font-semibold text-paper text-base">{initial}</Text>
        </View>
        <OnboardingProgress total={5} active={5} />
      </View>

      <RiseIn delay={0}>
        <View className="mt-12">
          <Text
            className="font-display-x text-ink dark:text-paper text-5xl"
            style={{ lineHeight: 48 }}
          >
            {t('onb.handle.title')}
          </Text>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base leading-6 mt-3">
            {t('onb.handle.sub')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View className="mt-10">
          <Text className="font-medium text-ink/70 dark:text-paper/70 text-sm uppercase tracking-wider mb-2">
            {t('onb.handle.name_label')}
          </Text>
          <TextInput
            value={name}
            onChangeText={(s) => {
              setError(null);
              setName(s.slice(0, 30));
            }}
            placeholder={t('onb.handle.name_placeholder')}
            placeholderTextColor={theme.fg + '4d'}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="givenName"
            maxLength={30}
            className="bg-paper dark:bg-ink border border-ink/15 dark:border-paper/15 rounded-2xl px-4 font-sans text-ink dark:text-paper"
            style={{ minHeight: 60, fontSize: 18 }}
          />
          {error ? (
            <Text className="font-sans text-coral text-xs mt-2 ml-1">{error}</Text>
          ) : null}
        </View>
      </RiseIn>

      <View className="flex-1" />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.handle.cta')}
          accessibilityState={{ disabled: !primaryEnabled }}
          onPress={onSubmit}
          disabled={!primaryEnabled}
          className={`${primaryEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20 dark:bg-paper/20'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && primaryEnabled ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${primaryEnabled ? 'text-paper' : 'text-ink/50 dark:text-paper/50'} font-semibold text-lg text-center`}
          >
            {busy ? '...' : t('onb.handle.cta')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onSkip}
          disabled={!primaryEnabled}
          hitSlop={8}
          className="mt-4"
        >
          <Text className="font-sans text-ink/55 dark:text-paper/55 text-sm text-center underline">
            {t('onb.handle.skip')}
          </Text>
        </Pressable>
      </RiseIn>
    </View>
  );
}
