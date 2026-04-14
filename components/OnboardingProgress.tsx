import { View } from 'react-native';
import { palette } from '@/constants/theme';

type Props = {
  total: number;
  active: number;
};

export function OnboardingProgress({ total, active }: Props) {
  return (
    <View className="flex-row gap-2">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === active ? palette.coral : palette.ink + '33',
          }}
        />
      ))}
    </View>
  );
}
