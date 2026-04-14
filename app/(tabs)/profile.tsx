import { View, Text } from 'react-native';
import { useT } from '@/hooks/useT';

export default function Profile() {
  const { t } = useT();
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Text className="font-display-x text-6xl text-ink">{t('tabs.profile')}</Text>
      <Text className="font-sans text-ink/60 mt-3">{t('tabs_sub.profile')}</Text>
    </View>
  );
}
