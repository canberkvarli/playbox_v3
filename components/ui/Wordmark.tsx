import { Text, type TextStyle } from 'react-native';

import { palette } from '@/constants/theme';

type Props = {
  size?: number;
  /** Uppercase the wordmark (e.g. for a mono-style header lockup). */
  upper?: boolean;
  style?: TextStyle;
};

/**
 * PLAYBOX wordmark lockup — "play" in the foreground color (dark on light /
 * white on dark) and "box" in volt. Archivo Expanded. Our brand mark; use on
 * the map header and brand surfaces.
 */
export function Wordmark({ size = 22, upper = false, style }: Props) {
  const play = upper ? 'PLAY' : 'play';
  const box = upper ? 'BOX' : 'box';
  return (
    <Text
      style={[
        { fontFamily: 'Unbounded_800ExtraBold', fontSize: size, letterSpacing: upper ? 1 : 0.3 },
        style,
      ]}
      accessibilityLabel="Playbox"
    >
      <Text style={{ color: palette.fg }}>{play}</Text>
      <Text style={{ color: palette.voltText }}>{box}</Text>
    </Text>
  );
}
