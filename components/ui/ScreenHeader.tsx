import { View, Text, type ViewStyle } from 'react-native';

import { palette } from '@/constants/theme';

type Props = {
  /** Small mono kicker above the title (e.g. "01 · HARİTA"). */
  kicker?: string;
  title: string;
  /** Optional muted line under the title. */
  subtitle?: string;
  kickerTone?: 'volt' | 'muted';
  style?: ViewStyle;
};

/**
 * The Anton headline + mono kicker used across the mockup frames
 * ("ŞEHRİN HER KÖŞESİ BİR SAHA"). Anton renders via the legacy Unbounded key.
 */
export function ScreenHeader({ kicker, title, subtitle, kickerTone = 'volt', style }: Props) {
  return (
    <View style={style}>
      {kicker ? (
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            fontSize: 11,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            color: kickerTone === 'volt' ? palette.volt : palette.muted,
            marginBottom: 10,
          }}
        >
          {kicker}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold', // -> Anton
          fontSize: 34,
          lineHeight: 40,
          textTransform: 'uppercase',
          color: palette.fg,
          letterSpacing: 0.5,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: palette.muted, marginTop: 12, lineHeight: 20 }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
