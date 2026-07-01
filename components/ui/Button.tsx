import { Pressable, Text, View, ActivityIndicator, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { palette } from '@/constants/theme';

type Variant = 'primary' | 'danger' | 'ghost';
type Size = 'lg' | 'md' | 'sm';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  haptic?: boolean;
  style?: ViewStyle;
};

const HEIGHTS: Record<Size, number> = { lg: 56, md: 48, sm: 38 };
const FONTS: Record<Size, number> = { lg: 15, md: 14, sm: 12 };

/**
 * Asphalt Volt button. `primary` = volt fill with dark ink (the OYNA CTA),
 * `danger` = coral-outlined (SEANSI BİTİR), `ghost` = hairline outline.
 * Uppercase tracked Inter labels. Uses static styles + inner View because this
 * RN build can drop function-form Pressable styles.
 */
export function Button({
  label, onPress, variant = 'primary', size = 'lg',
  icon, disabled, loading, full = true, haptic = true, style,
}: Props) {
  const height = HEIGHTS[size];
  const fill =
    variant === 'primary' ? palette.volt :
    variant === 'danger'  ? 'transparent' :
    'transparent';
  const borderColor =
    variant === 'danger' ? palette.danger :
    variant === 'ghost'  ? palette.border :
    palette.volt;
  const fg =
    variant === 'primary' ? palette.voltInk :
    variant === 'danger'  ? palette.danger :
    palette.fg;

  const handle = () => {
    if (disabled || loading) return;
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  return (
    <Pressable
      onPress={handle}
      disabled={disabled || loading}
      style={{
        opacity: disabled ? 0.45 : 1,
        alignSelf: full ? 'stretch' : 'flex-start',
        ...style,
      }}
    >
      <View
        style={{
          height,
          borderRadius: 999,
          backgroundColor: fill,
          borderWidth: variant === 'primary' ? 0 : 1.5,
          borderColor,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: size === 'sm' ? 18 : 26,
        }}
      >
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon ? <Feather name={icon} size={FONTS[size] + 3} color={fg} /> : null}
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: FONTS[size],
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                color: fg,
              }}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}
