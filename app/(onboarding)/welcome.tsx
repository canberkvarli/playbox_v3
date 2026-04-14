import { View, Text } from 'react-native';
import { useT } from '@/hooks/useT';

export default function Welcome() {
  const { t } = useT();
  return (
    <View className="flex-1 items-center justify-center bg-paper px-6">
      <Text className="font-display-x text-6xl text-ink text-center">playbox</Text>
      <Text className="font-sans text-ink/60 text-center mt-3">{t('onb.welcome.sub')}</Text>
    </View>
  );
}
