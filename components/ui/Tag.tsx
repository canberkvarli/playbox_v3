import { View, Text, type ViewStyle } from 'react-native';

import { palette } from '@/constants/theme';

type Props = {
  label: string;
  /** Optional count shown after the label (e.g. "basket 3"). */
  count?: number | string;
  /** Accent dot color; defaults to volt. */
  dot?: string;
  tone?: 'volt' | 'coral' | 'muted';
  style?: ViewStyle;
};

/**
 * Small mono chip used for sport tags / counts (the "basket 3 · futbol 2" pills
 * on the map card). Uppercase JetBrains Mono with a colored dot.
 */
export function Tag({ label, count, dot, tone = 'volt', style }: Props) {
  const accent =
    tone === 'coral' ? palette.danger :
    tone === 'muted' ? palette.muted :
    palette.volt;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: palette.ink + '14',
        ...style,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot ?? accent }} />
      <Text
        style={{
          fontFamily: 'JetBrainsMono_500Medium',
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: palette.fg,
        }}
      >
        {label}
        {count != null ? <Text style={{ color: palette.muted }}>{'  ' + count}</Text> : null}
      </Text>
    </View>
  );
}
