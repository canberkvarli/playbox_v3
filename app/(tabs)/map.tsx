import { View, Text } from 'react-native';

export default function Map() {
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Text className="font-display-x text-6xl text-ink">map</Text>
      <Text className="font-sans text-ink/60 mt-3">yakındaki istasyonlar</Text>
    </View>
  );
}
