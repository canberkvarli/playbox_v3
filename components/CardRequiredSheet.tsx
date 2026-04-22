import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';

type Props = {
  holdAmountTry: number;
};

export function CardRequiredSheet({ holdAmountTry }: Props) {
  const { t } = useT();

  const onAddCard = async () => {
    await hx.tap();
    router.push('/card-add');
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: palette.paper,
        paddingHorizontal: 24,
        justifyContent: 'center',
      }}
    >
      <RiseIn delay={0}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: palette.butter,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Feather name="credit-card" size={32} color={palette.ink} />
        </View>
      </RiseIn>

      <RiseIn delay={60}>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 34,
            lineHeight: 38,
          }}
        >
          {t('card.blocking.title')}
        </Text>
      </RiseIn>

      <RiseIn delay={140}>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.ink + 'B3',
            fontSize: 16,
            lineHeight: 22,
            marginTop: 16,
          }}
        >
          {t('card.blocking.sub')}
        </Text>
      </RiseIn>

      <RiseIn delay={220}>
        <View
          style={{
            backgroundColor: palette.ink + '08',
            borderRadius: 16,
            padding: 16,
            marginTop: 20,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <Feather name="info" size={18} color={palette.ink + '99'} style={{ marginTop: 2 }} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_400Regular',
              color: palette.ink + 'B3',
              fontSize: 14,
              lineHeight: 20,
            }}
          >
            {t('card.blocking.detail', { amount: holdAmountTry })}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={300}>
        <Pressable
          onPress={onAddCard}
          accessibilityRole="button"
          accessibilityLabel={t('card.blocking.cta')}
          style={({ pressed }) => ({
            backgroundColor: palette.coral,
            borderRadius: 20,
            paddingVertical: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            marginTop: 28,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Feather name="plus" size={20} color={palette.paper} />
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.paper,
              fontSize: 18,
            }}
          >
            {t('card.blocking.cta')}
          </Text>
        </Pressable>
      </RiseIn>
    </View>
  );
}
