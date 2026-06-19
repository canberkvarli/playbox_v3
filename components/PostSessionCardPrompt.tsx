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
          backgroundColor: palette.mauve + '14',
          borderRadius: 24,
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
              backgroundColor: palette.mauve + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="credit-card" size={16} color={palette.mauve} />
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 16,
              lineHeight: 20,
            }}
          >
            {t('card.post_session.title')}
          </Text>
        </View>

        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.ink + '99',
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
                  borderColor: palette.ink + '22',
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_700Bold',
                    color: palette.ink,
                    fontSize: 14,
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
                  backgroundColor: '#e87527',
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: 'center',
                  shadowColor: '#e87527',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  elevation: 6,
                  opacity: pressed ? 0.85 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_700Bold',
                    color: '#ffffff',
                    fontSize: 14,
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
