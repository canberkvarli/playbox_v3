import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { resetToOnboarding } from '@/lib/nav/resetToOnboarding';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useGuardedPress } from '@/hooks/useGuardedPress';
import { getDriver } from '@/lib/hardware';
import { openLegal } from '@/lib/legal';

const RULES = [
  {
    icon: 'phone' as const,
    title: 'telefon numarası',
    body: 'hesabını oluşturmak ve giriş yapman için sms kodu göndermek üzere kullanılır.',
  },
  {
    icon: 'map-pin' as const,
    title: 'konum',
    body: 'yakındaki istasyonları gösterip, kapıya yaklaştığında oynatma için kullanılır.',
  },
  {
    icon: 'credit-card' as const,
    title: 'kart bilgileri',
    body: 'iyzico üzerinden saklanır. playbox kart numaranı hiçbir zaman görmez.',
  },
  {
    icon: 'activity' as const,
    title: 'seans verileri',
    body: 'haftalık şehir sıralaması ve seri sayacı için kullanılır. profil ekranında sen de görürsün.',
  },
];

export default function Kvkk() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAccept = useGuardedPress(async () => {
    if (busy || !user) return;
    setBusy(true);
    setError(null);
    await hx.press();

    const meta: Record<string, unknown> = {
      kvkk_accepted_at: new Date().toISOString(),
      kvkk_version: '1.0',
    };

    const { error: err } = await supabase.auth.updateUser({ data: meta });
    if (err) {
      console.warn('[kvkk] accept failed', err);
      await hx.no();
      setError('kaydedilemedi, tekrar dene');
      setBusy(false);
      return;
    }

    await hx.yes();
    const onboarded = user.user_metadata?.onboarded === true;
    router.replace(onboarded ? '/(tabs)/map' : '/(onboarding)/handle');
  });

  const onOpenPrivacy = useGuardedPress(async () => {
    await hx.tap();
    await openLegal('kvkk');
  });

  const onBack = useGuardedPress(async () => {
    await hx.tap();
    // Backing out of KVKK = signing out, since the account has no usable
    // state without consent. Sends them back to phone entry.
    // Best-effort BLE teardown so no module state leaks across accounts.
    try {
      getDriver().reset();
    } catch {
      /* ignore — teardown is best-effort */
    }
    await supabase.auth.signOut();
    resetToOnboarding();
  });

  return (
    <View
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
          onPress={onBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="geri"
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
        <OnboardingProgress total={6} active={5} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 32 }}>
          <View
            style={{
              backgroundColor: palette.volt,
              alignSelf: 'flex-start',
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.voltInk,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
              }}
            >
              kvkk · gizlilik
            </Text>
          </View>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 36,
              lineHeight: 42,
            }}
          >
            verilerin nasıl kullanılır
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.muted,
              fontSize: 15,
              lineHeight: 22,
              marginTop: 12,
            }}
          >
            6698 sayılı kvkk kapsamında işlediğimiz verileri ve nedenlerini buradan görebilirsin.
          </Text>
        </View>
      </RiseIn>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 22, paddingBottom: 12 }}
        style={{ flex: 1 }}
      >
        {RULES.map((r, i) => (
          <RiseIn key={r.title} delay={120 + i * 70}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: 16,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: palette.volt + '1f',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14,
                }}
              >
                <Feather name={r.icon} size={20} color={palette.voltText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.fg,
                    fontSize: 15,
                    letterSpacing: 0.2,
                  }}
                >
                  {r.title}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.muted,
                    fontSize: 13,
                    lineHeight: 18,
                    marginTop: 4,
                  }}
                >
                  {r.body}
                </Text>
              </View>
            </View>
          </RiseIn>
        ))}

        <Pressable
          onPress={onOpenPrivacy}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 4 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 12,
            }}
          >
            <Feather name="external-link" size={14} color={palette.voltText} style={{ marginRight: 6 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.voltText,
                fontSize: 13,
                textDecorationLine: 'underline',
              }}
            >
              tam aydınlatma metnini oku
            </Text>
          </View>
        </Pressable>
      </ScrollView>

      {error ? (
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.danger,
            fontSize: 12,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          {error}
        </Text>
      ) : null}

      <RiseIn delay={120}>
        <Button
          label="okudum, kabul ediyorum"
          icon="check"
          onPress={onAccept}
          disabled={busy}
          loading={busy}
          full
        />
      </RiseIn>
    </View>
  );
}
