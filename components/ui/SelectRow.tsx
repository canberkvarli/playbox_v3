import { Pressable, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';

type Props = {
  icon?: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
};

/**
 * A selectable list row for the "SPOR SEÇ" picker. Selected = volt border + volt
 * dot; a dark surface row otherwise. Static styles + inner View (Pressable
 * function-style caveat).
 */
export function SelectRow({ icon, title, subtitle, selected, disabled, onPress }: Props) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.4 : 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderRadius: 18,
          backgroundColor: selected ? palette.volt + '14' : palette.surface,
          borderWidth: 1.5,
          borderColor: selected ? palette.volt : palette.border,
        }}
      >
        {icon ? (
          <View
            style={{
              width: 38, height: 38, borderRadius: 12,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: palette.surfaceAlt,
            }}
          >
            <Feather name={icon} size={18} color={selected ? palette.volt : palette.fg} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: palette.fg }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12.5, color: palette.muted, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            width: 20, height: 20, borderRadius: 10,
            borderWidth: 2, borderColor: selected ? palette.volt : palette.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {selected ? (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette.volt }} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
