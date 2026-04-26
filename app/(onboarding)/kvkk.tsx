import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';

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

const PRIVACY_URL = 'https://playbox.app/gizlilik';

export default function Kvkk() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAccept = async () => {
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
  };

  const onOpenPrivacy = async () => {
    await hx.tap();
    Linking.openURL(PRIVACY_URL).catch(() => {});
  };

  const onBack = async () => {
    await hx.tap();
    // Backing out of KVKK = signing out, since the account has no usable
    // state without consent. Sends them back to phone entry.
    await supabase.auth.signOut();
    router.replace('/(onboarding)/welcome');
  };

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
        <OnboardingProgress total={6} active={5} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 32 }}>
          <View
            style={{
              backgroundColor: palette.butter,
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
                color: palette.ink,
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
              color: palette.ink,
              fontSize: 36,
              lineHeight: 40,
            }}
          >
            verilerin nasıl kullanılır
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 15,
              lineHeight: 22,
              marginTop: 12,
              opacity: 0.85,
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
                backgroundColor: palette.paper,
                borderWidth: 1.5,
                borderColor: palette.ink + '22',
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
                  backgroundColor: palette.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14,
                }}
              >
                <Feather name={r.icon} size={20} color={palette.paper} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.ink,
                    fontSize: 15,
                    letterSpacing: 0.2,
                  }}
                >
                  {r.title}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.ink,
                    fontSize: 13,
                    lineHeight: 18,
                    marginTop: 4,
                    opacity: 0.85,
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
            <Feather name="external-link" size={14} color={palette.ink} style={{ marginRight: 6 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
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
            color: palette.coral,
            fontSize: 12,
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          {error}
        </Text>
      ) : null}

      <RiseIn delay={120}>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="kabul ediyorum"
          style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 20,
              paddingVertical: 20,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.32,
              shadowRadius: 18,
              elevation: 12,
            }}
          >
            <Feather name="check" size={20} color={palette.paper} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 18,
                letterSpacing: 0.5,
              }}
            >
              {busy ? '...' : 'okudum, kabul ediyorum'}
            </Text>
          </View>
        </Pressable>
      </RiseIn>
    </View>
  );
}
