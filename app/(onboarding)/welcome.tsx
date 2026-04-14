import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';

export default function Welcome() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.welcome.title').split('\n');

  const onStart = async () => {
    await hx.press();
    router.push('/(onboarding)/intro-map');
  };

  return (
    <View
      className="flex-1 bg-paper px-6"
      style={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 }}
    >
      <Text className="font-medium text-mauve uppercase tracking-widest text-sm">
        {t('onb.welcome.eyebrow')}
      </Text>

      <View className="mt-3">
        {titleLines.map((line, i) => (
          <Text
            key={i}
            className="font-display-x text-ink text-6xl"
            style={{ lineHeight: 56 }}
          >
            {line}
          </Text>
        ))}
      </View>

      <Text className="font-sans text-lg text-ink/70 mt-6 leading-6">
        {t('onb.welcome.sub')}
      </Text>

      <View className="flex-1" />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onb.welcome.cta')}
        onPress={onStart}
        className="bg-coral rounded-2xl py-5 active:opacity-90"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
      >
        <Text className="text-paper font-semibold text-lg text-center">
          {t('onb.welcome.cta')}
        </Text>
      </Pressable>
    </View>
  );
}
