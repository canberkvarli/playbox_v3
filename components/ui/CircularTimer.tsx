import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { palette } from '@/constants/theme';

type Props = {
  /** 0..1 remaining fraction (drives the volt arc). */
  progress: number;
  /** Center label, e.g. "12:48". */
  time: string;
  /** Small caption under the time, e.g. "90 dk planlandı". */
  caption?: string;
  size?: number;
  stroke?: number;
  /** Arc color; coral when running low. */
  color?: string;
};

/**
 * The active-session ring from the mockup: a volt progress arc on a dark track,
 * with a big JetBrains Mono countdown in the center.
 */
export function CircularTimer({
  progress, time, caption, size = 240, stroke = 14, color = palette.volt,
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = c * (1 - clamped);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={palette.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        />
      </Svg>
      <Text style={{ fontFamily: 'JetBrainsMono_700Bold', fontSize: size * 0.24, color: palette.fg, letterSpacing: 1 }}>
        {time}
      </Text>
      {caption ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: palette.muted, marginTop: 6 }}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
