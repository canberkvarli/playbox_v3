import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';

type Props = {
  onSkip?: () => void;
};

export function PostSessionCardPrompt({ onSkip }: Props) {
  const { t } = useT();

  const onAddCard = async () => {
    await hx.tap();
    router.push('/card-add');
  };

  const onLater = async () => {
    await hx.tap();
    onSkip?.();
  };

  return (
    <RiseIn delay={380}>
      <View
        style={{
          backgroundColor: palette.surfaceAlt,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: palette.border,
          padding: 20,
          marginTop: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="credit-card" size={16} color={palette.volt} />
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily: 'Unbounded_700Bold',
              color: palette.fg,
              fontSize: 16,
              lineHeight: 20,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
          >
            {t('card.post_session.title')}
          </Text>
        </View>

        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.muted,
            fontSize: 13,
            lineHeight: 18,
            marginTop: 8,
          }}
        >
          {t('card.post_session.sub')}
        </Text>

        {/* flex:1 lives statically on the Pressables (function-form Pressable
            `style` is dropped on this RN build); the background + layout live on
            a static inner View rendered via the function-CHILD. This is why the
            orange "kart ekle" bg was disappearing and leaving its white label
            invisible on the light card. */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Pressable onPress={onLater} style={{ flex: 1 }}>
            {({ pressed }) => (
              <View
                style={{
                  borderWidth: 1.5,
                  borderColor: palette.border,
                  borderRadius: 999,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.fg,
                    fontSize: 13,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('card.post_session.cta_secondary')}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={onAddCard} style={{ flex: 1 }}>
            {({ pressed }) => (
              <View
                style={{
                  backgroundColor: palette.volt,
                  borderRadius: 999,
                  paddingVertical: 14,
                  alignItems: 'center',
                  shadowColor: palette.volt,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  elevation: 6,
                  opacity: pressed ? 0.85 : 1,
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
                  {t('card.post_session.cta_primary')}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </RiseIn>
  );
}
