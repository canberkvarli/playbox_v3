import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { useGuardedPress } from '@/hooks/useGuardedPress';

export default function Welcome() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.welcome.title').split('\n');

  const onStart = useGuardedPress(async () => {
    await hx.press();
    router.push('/(onboarding)/intro-map');
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingHorizontal: 24,
        paddingTop: insets.top + 32,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <RiseIn delay={0}>
        <View style={{ marginTop: 12 }}>
          {titleLines.map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 56,
                lineHeight: 60,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 17,
            lineHeight: 24,
            marginTop: 22,
            opacity: 0.85,
          }}
        >
          {t('onb.welcome.sub')}
        </Text>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.welcome.cta')}
          onPress={onStart}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 20,
              paddingVertical: 20,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.32,
              shadowRadius: 18,
              elevation: 12,
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
              {t('onb.welcome.cta')}
            </Text>
          </View>
        </Pressable>
      </RiseIn>
    </View>
  );
}
