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
          backgroundColor: palette.mauve + '22',
          borderRadius: 24,
          padding: 20,
          marginTop: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.mauve,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="credit-card" size={18} color={palette.paper} />
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
            color: palette.ink + 'B3',
            fontSize: 14,
            lineHeight: 20,
            marginTop: 12,
          }}
        >
          {t('card.post_session.sub')}
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Pressable
            onPress={onLater}
            style={({ pressed }) => ({
              flex: 1,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderColor: palette.ink + '22',
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
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
          </Pressable>
          <Pressable
            onPress={onAddCard}
            style={({ pressed }) => ({
              flex: 1,
              backgroundColor: palette.ink,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.paper,
                fontSize: 14,
              }}
            >
              {t('card.post_session.cta_primary')}
            </Text>
          </Pressable>
        </View>
      </View>
    </RiseIn>
  );
}
