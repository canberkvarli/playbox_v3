import { View, Text, type ViewStyle } from 'react-native';

import { palette, darkPalette } from '@/constants/theme';

type Props = {
  size?: number;
  upper?: boolean;
  /** Render on a dark chip so the bright volt "box" reads on any background. */
  chip?: boolean;
  style?: ViewStyle;
};

/**
 * PLAYBOX wordmark — "play" in near-white + "box" in bright volt. The brand
 * green stays vivid; on light surfaces we sit it on a dark asphalt chip so it
 * pops (rather than dulling the green). Archivo Expanded.
 */
export function Wordmark({ size = 22, upper = false, chip = true, style }: Props) {
  const play = upper ? 'PLAY' : 'play';
  const box = upper ? 'BOX' : 'box';
  const text = (
    <Text
      style={{ fontFamily: 'Unbounded_800ExtraBold', fontSize: size, letterSpacing: upper ? 1 : 0.3 }}
      accessibilityLabel="Playbox"
    >
      <Text style={{ color: darkPalette.fg }}>{play}</Text>
      <Text style={{ color: palette.volt }}>{box}</Text>
    </Text>
  );
  if (!chip) return text;
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: darkPalette.bg, // asphalt chip — always dark so volt reads
          paddingHorizontal: size * 0.55,
          paddingVertical: size * 0.34,
          borderRadius: size * 0.7,
        },
        style,
      ]}
    >
      {text}
    </View>
  );
}
