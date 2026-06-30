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
 * Warm "nothing here yet" placeholder: an icon in a butter circle, an Unbounded
 * title, an optional muted subtitle, and an optional coral pill CTA. Matches the
 * pattern already used on the reservations screen; reuse it for any empty list
 * so empty states feel intentional and on-brand instead of a bare line of text.
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
          backgroundColor: palette.butter,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Feather name={icon} size={36} color={palette.ink} />
      </View>

      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 20,
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
            color: palette.ink + '99',
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
              backgroundColor: palette.coral,
              borderRadius: 999,
              paddingHorizontal: 22,
              paddingVertical: 12,
            }}
          >
            <Text style={{ fontFamily: 'Unbounded_700Bold', color: palette.paper, fontSize: 14 }}>
              {cta.label}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
