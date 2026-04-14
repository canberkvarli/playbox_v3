import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function Otp() {
  const { phone } = useLocalSearchParams<{ phone?: string }>();
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <Text className="font-display-x text-4xl text-ink">otp</Text>
      <Text className="font-sans text-ink/60 mt-3">
        Task 15 will build this — phone: {phone ?? '(none)'}
      </Text>
    </View>
  );
}
