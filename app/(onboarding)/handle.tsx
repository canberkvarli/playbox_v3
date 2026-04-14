import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@clerk/clerk-expo';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

function sanitizeHandle(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

export default function Handle() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isLoaded } = useUser();

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const handleValid = useMemo(() => HANDLE_RE.test(handle), [handle]);
  const nameValid = name.trim().length >= 1;
  const ctaEnabled = nameValid && handleValid && !busy && isLoaded;

  const onChangeHandle = (s: string) => {
    setError(null);
    setHandle(sanitizeHandle(s));
  };

  const onChangeName = (s: string) => {
    setError(null);
    setName(s.slice(0, 30));
  };

  const onSubmit = async () => {
    if (!ctaEnabled || !user) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    await hx.press();
    try {
      await user.update({
        firstName: name.trim(),
        username: handle,
      });
      await hx.yes();
      router.replace('/(tabs)/map');
    } catch (e: any) {
      await hx.no();
      const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message;
      setError(msg ?? t('onb.handle.save_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      className="flex-1 bg-paper px-6"
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
        <OnboardingProgress total={6} active={5} />
      </View>

      <RiseIn delay={0}>
        <View className="mt-12">
          <Text
            className="font-display-x text-ink text-5xl"
            style={{ lineHeight: 48 }}
          >
            {t('onb.handle.title')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View className="mt-8">
          <Text className="font-medium text-ink/70 text-sm uppercase tracking-wider mb-2">
            {t('onb.handle.name_label')}
          </Text>
          <TextInput
            value={name}
            onChangeText={onChangeName}
            placeholder="..."
            placeholderTextColor={palette.ink + '4d'}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="givenName"
            maxLength={30}
            className="bg-paper border border-ink/15 rounded-2xl px-4 py-4 font-sans text-ink text-lg"
            style={{ minHeight: 56 }}
          />
        </View>
      </RiseIn>

      <RiseIn delay={200}>
       <View className="mt-6">
        <Text className="font-medium text-ink/70 text-sm uppercase tracking-wider mb-2">
          {t('onb.handle.handle_label')}
        </Text>
        <View className="flex-row gap-3 items-center">
          <View
            style={{
              backgroundColor: palette.ink,
              borderRadius: 16,
              paddingHorizontal: 14,
              paddingVertical: 16,
            }}
          >
            <Text className="font-mono text-paper text-lg">@</Text>
          </View>
          <TextInput
            value={handle}
            onChangeText={onChangeHandle}
            placeholder="kullanici_adi"
            placeholderTextColor={palette.ink + '4d'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            maxLength={20}
            className="flex-1 bg-paper border border-ink/15 rounded-2xl px-4 py-4 font-mono text-ink text-lg"
            style={{ minHeight: 56 }}
          />
        </View>
        {error ? (
          <Text className="font-sans text-coral text-xs mt-2 ml-1">{error}</Text>
        ) : handle.length > 0 && !handleValid ? (
          <Text className="font-sans text-coral text-xs mt-2 ml-1">
            {t('onb.handle.invalid')}
          </Text>
        ) : (
          <Text className="font-sans text-ink/50 text-xs mt-2 ml-1">
            {t('onb.handle.hint')}
          </Text>
        )}
       </View>
      </RiseIn>

      <View className="flex-1" />

      <RiseIn delay={300}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.handle.cta')}
          accessibilityState={{ disabled: !ctaEnabled }}
          onPress={onSubmit}
          disabled={!ctaEnabled}
          className={`${ctaEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && ctaEnabled ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${ctaEnabled ? 'text-paper' : 'text-ink/50'} font-semibold text-lg text-center`}
          >
            {busy ? '...' : t('onb.handle.cta')}
          </Text>
        </Pressable>
      </RiseIn>
    </View>
  );
}
