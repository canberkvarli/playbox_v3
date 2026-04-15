import { View } from 'react-native';

import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

type Props = {
  total: number;
  active: number;
};

export function OnboardingProgress({ total, active }: Props) {
  const theme = useTheme();
  return (
    <View className="flex-row gap-2">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === active ? palette.coral : theme.fg + '33',
          }}
        />
      ))}
    </View>
  );
}
