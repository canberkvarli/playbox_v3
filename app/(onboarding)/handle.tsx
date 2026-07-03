import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useGuardedPress } from '@/hooks/useGuardedPress';

function defaultUsername(userId: string): string {
  return `oyuncu_${userId.slice(-6)}`;
}

export default function Handle() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const onSubmit = useGuardedPress(() => finish(true));
  const onSkip = useGuardedPress(() => finish(false));

  const primaryEnabled = !busy && !loading;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 16,
        }}
      >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1,
            borderColor: palette.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.voltText,
              fontSize: 16,
            }}
          >
            {initial}
          </Text>
        </View>
        <OnboardingProgress total={5} active={5} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 40 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 44,
              lineHeight: 52,
            }}
          >
            {t('onb.handle.title')}
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
            {t('onb.handle.sub')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View style={{ marginTop: 32 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 12,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            {t('onb.handle.name_label')}
          </Text>
          <TextInput
            value={name}
            onChangeText={(s) => {
              setError(null);
              setName(s.slice(0, 30));
            }}
            placeholder={t('onb.handle.name_placeholder')}
            placeholderTextColor={palette.muted}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="givenName"
            maxLength={30}
            style={{
              backgroundColor: palette.surfaceAlt,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 16,
              paddingHorizontal: 16,
              fontFamily: 'Inter_600SemiBold',
              color: palette.fg,
              minHeight: 60,
              fontSize: 18,
            }}
          />
          {error ? (
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.danger,
                fontSize: 12,
                marginTop: 8,
                marginLeft: 4,
              }}
            >
              {error}
            </Text>
          ) : null}
        </View>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Button
          label={t('onb.handle.cta')}
          onPress={onSubmit}
          disabled={!primaryEnabled}
          loading={busy}
          full
        />
        <Pressable
          accessibilityRole="button"
          onPress={onSkip}
          disabled={!primaryEnabled}
          hitSlop={8}
          style={({ pressed }) => ({ marginTop: 24, opacity: pressed ? 0.55 : 1 })}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.muted,
              fontSize: 13,
              textAlign: 'center',
              textDecorationLine: 'underline',
            }}
          >
            {t('onb.handle.skip')}
          </Text>
        </Pressable>
      </RiseIn>
      </View>
    </KeyboardAvoidingView>
  );
}
