import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';

type Props = {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  /** Optional coral pill CTA below the text. */
  cta?: { label: string; onPress: () => void };
};

/**
 * Asphalt Volt "nothing here yet" placeholder: an icon in a subtle surfaceAlt
 * circle (volt glyph), an Anton title, an optional muted subtitle, and an
 * optional volt pill CTA. Reuse it for any empty list so empty states feel
 * intentional and on-brand instead of a bare line of text.
 *
 * NOTE: the CTA uses a STATIC style + inner View (not a function-form Pressable
 * style) — this RN build drops function-form styles in some cases, which would
 * make the button vanish.
 */
export function EmptyState({ icon, title, subtitle, cta }: Props) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 56,
        paddingHorizontal: 24,
      }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: palette.surfaceAlt,
          borderWidth: 1,
          borderColor: palette.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Feather name={icon} size={36} color={palette.volt} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.fg,
          fontSize: 20,
          lineHeight: 24,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          textAlign: 'center',
          marginBottom: subtitle ? 10 : 0,
        }}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.muted,
            fontSize: 13,
            textAlign: 'center',
            maxWidth: 280,
            lineHeight: 19,
            marginBottom: cta ? 22 : 0,
          }}
        >
          {subtitle}
        </Text>
      ) : null}

      {cta ? (
        <Pressable onPress={cta.onPress} hitSlop={8}>
          <View
            style={{
              backgroundColor: palette.volt,
              borderRadius: 999,
              paddingHorizontal: 22,
              paddingVertical: 12,
            }}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.voltInk,
                fontSize: 13,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {cta.label}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
