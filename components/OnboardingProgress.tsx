import { View } from 'react-native';

import { palette } from '@/constants/theme';

type Props = {
  total: number;
  active: number;
};

export function OnboardingProgress({ total, active }: Props) {
  return (
    <View className="flex-row gap-2">
      {Array.from({ length: total }, (_, i) => {
        const isActive = i === active;
        return (
          <View
            key={i}
            style={{
              width: isActive ? 24 : 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: isActive ? palette.coral : '#ffffff',
              borderWidth: isActive ? 0 : 2,
              borderColor: palette.ink + '55',
            }}
          />
        );
      })}
    </View>
  );
}
