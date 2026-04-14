import { View, Text } from 'react-native';

export default function Welcome() {
  return (
    <View className="flex-1 items-center justify-center bg-paper px-6">
      <Text className="font-display-x text-6xl text-ink text-center">playbox</Text>
      <Text className="font-sans text-ink/60 text-center mt-3">
        yakında: karşılama akışı
      </Text>
    </View>
  );
}
