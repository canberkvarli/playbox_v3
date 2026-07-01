import { View, type ViewProps, type ViewStyle } from 'react-native';

import { palette } from '@/constants/theme';

type Props = ViewProps & {
  /** 'card' = raised surface, 'well' = deepest inset, 'alt' = input/raised alt. */
  tone?: 'card' | 'well' | 'alt';
  radius?: number;
  padding?: number;
  bordered?: boolean;
  style?: ViewStyle;
};

/**
 * Asphalt Volt surface. A dark card (#202127) with an optional hairline border,
 * matching the station/session cards in the mockup.
 */
export function Surface({
  tone = 'card', radius = 24, padding = 16, bordered = true, style, children, ...rest
}: Props) {
  const bg =
    tone === 'well' ? palette.deep :
    tone === 'alt'  ? palette.surfaceAlt :
    palette.surface;
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius,
          padding,
          borderWidth: bordered ? 1 : 0,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
