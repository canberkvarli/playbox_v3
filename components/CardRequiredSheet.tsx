import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();

  const onAddCard = async () => {
    await hx.tap();
    router.push('/card-add');
  };

  const onBack = async () => {
    await hx.tap();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/map');
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: palette.bg,
        paddingHorizontal: 24,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 20,
      }}
    >
      {/* Back button — icon-only circle at top-left, no overlap with content */}
      <Pressable
        onPress={onBack}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="geri"
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
          marginBottom: 28,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1,
            borderColor: palette.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="arrow-left" size={20} color={palette.fg} />
        </View>
      </Pressable>

      <RiseIn delay={0}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1,
            borderColor: palette.border,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Feather name="credit-card" size={32} color={palette.volt} />
        </View>
      </RiseIn>

      <RiseIn delay={60}>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 38,
            lineHeight: 45,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {t('card.blocking.title')}
        </Text>
      </RiseIn>

      <RiseIn delay={140}>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.muted,
            fontSize: 17,
            lineHeight: 24,
            marginTop: 18,
          }}
        >
          {t('card.blocking.sub')}
        </Text>
      </RiseIn>

      <RiseIn delay={220}>
        <View
          style={{
            backgroundColor: palette.surfaceAlt,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: palette.border,
            padding: 16,
            marginTop: 22,
            flexDirection: 'row',
            alignItems: 'flex-start',
          }}
        >
          <Feather name="info" size={20} color={palette.volt} style={{ marginTop: 2, marginRight: 12 }} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_600SemiBold',
              color: palette.fg,
              fontSize: 15,
              lineHeight: 21,
            }}
          >
            {t('card.blocking.detail', { amount: holdAmountTry })}
          </Text>
        </View>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={onAddCard}
        accessibilityRole="button"
        accessibilityLabel={t('card.blocking.cta')}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <View
          style={{
            backgroundColor: palette.volt,
            borderRadius: 999,
            paddingVertical: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: palette.volt,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.3,
            shadowRadius: 18,
            elevation: 10,
          }}
        >
          <Feather name="plus" size={20} color={palette.voltInk} style={{ marginRight: 10 }} />
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.voltInk,
              fontSize: 16,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {t('card.blocking.cta')}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
