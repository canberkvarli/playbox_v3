import { Alert, Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { usePaymentStore } from '@/stores/paymentStore';

const SCREEN_W = Dimensions.get('window').width;
// 24 page padding on left + 24 on right + a small peek of the next card so
// users know they can swipe.
const CARD_W = Math.round(SCREEN_W - 48 - 36);
const CARD_GAP = 14;

export default function Payments() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();

  const cardStatus = usePaymentStore((s) => s.cardStatus);
  const last4 = usePaymentStore((s) => s.cardLast4);
  const brand = usePaymentStore((s) => s.cardBrand);
  const clearCard = usePaymentStore((s) => s.clearCard);

  const onAddCard = async () => {
    await hx.tap();
    router.push('/card-add');
  };

  const onRemove = async () => {
    await hx.tap();
    Alert.alert(t('payments.remove_title'), t('payments.remove_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('payments.remove_cta'),
        style: 'destructive',
        onPress: () => {
          clearCard();
          hx.no();
        },
      },
    ]);
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Header — back pill + page label */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="geri"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.ink + '0d',
              borderWidth: 1,
              borderColor: palette.ink + '14',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.ink} />
          </View>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 40,
        }}
      >
        {/* Page title */}
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
            fontSize: 38,
            lineHeight: 42,
            marginTop: 16,
          }}
        >
          ödemeler
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 16,
            lineHeight: 22,
            marginTop: 8,
          }}
        >
          kartını yönet ve önceki seansların ücretlerini gör.
        </Text>

        {/* Section: card on file */}
        <SectionLabel>kayıtlı kart</SectionLabel>

        {cardStatus === 'on_file' && last4 ? (
          <>
            {/* Horizontally swipeable card carousel — currently shows the one
                saved card + an "add another" tile. Snap behavior + a small
                peek of the next tile telegraphs that it's swipeable. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={CARD_W + CARD_GAP}
              snapToAlignment="start"
              contentContainerStyle={{ paddingRight: 24 }}
              style={{ marginHorizontal: -24 }}
            >
              <View style={{ width: 24 }} />
              <View
                style={{
                  width: CARD_W,
                  marginRight: CARD_GAP,
                  backgroundColor: palette.ink,
                  borderRadius: 24,
                  padding: 24,
                  aspectRatio: 1.586,
                  justifyContent: 'space-between',
                  shadowColor: palette.ink,
                  shadowOffset: { width: 0, height: 14 },
                  shadowOpacity: 0.28,
                  shadowRadius: 24,
                  elevation: 12,
                }}
              >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: palette.butter,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name="credit-card" size={22} color={palette.ink} />
                </View>
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.butter,
                    fontSize: 13,
                    letterSpacing: 2.4,
                    textTransform: 'uppercase',
                  }}
                >
                  {brand ?? 'kart'}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_500Medium',
                  color: palette.paper,
                  fontSize: 24,
                  letterSpacing: 5,
                }}
              >
                ···· {last4}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.butter,
                    fontSize: 14,
                    letterSpacing: 3.6,
                  }}
                >
                  PLAYBOX
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: palette.paper + '14',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: '#3aaf6a',
                      marginRight: 6,
                    }}
                  />
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: palette.paper,
                      fontSize: 10,
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                    }}
                  >
                    aktif
                  </Text>
                </View>
              </View>
              </View>

              {/* Add-another tile — same dimensions, dashed outline */}
              <Pressable
                onPress={onAddCard}
                accessibilityRole="button"
                accessibilityLabel="başka kart ekle"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <View
                  style={{
                    width: CARD_W,
                    aspectRatio: 1.586,
                    borderRadius: 24,
                    borderWidth: 2,
                    borderStyle: 'dashed',
                    borderColor: palette.ink + '33',
                    backgroundColor: palette.ink + '06',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: palette.coral + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <Feather name="plus" size={28} color={palette.coral} />
                  </View>
                  <Text
                    style={{
                      fontFamily: 'Unbounded_800ExtraBold',
                      color: palette.ink,
                      fontSize: 16,
                      letterSpacing: 0.3,
                    }}
                  >
                    yeni kart ekle
                  </Text>
                </View>
              </Pressable>
            </ScrollView>

            {/* Two compact ghost buttons side-by-side — change card on the
                left, destructive remove on the right. Equal weight, no
                shadows, no overlap. */}
            <View
              style={{
                flexDirection: 'row',
                marginTop: 18,
                paddingHorizontal: 8,
                gap: 12,
              }}
            >
              <Pressable
                onPress={onAddCard}
                accessibilityRole="button"
                accessibilityLabel="kartı değiştir"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: palette.ink + '0d',
                    borderWidth: 1,
                    borderColor: palette.ink + '14',
                    padding:10
                  }}
                >
                  <Feather
                    name="refresh-ccw"
                    size={14}
                    color={palette.ink}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: palette.ink,
                      fontSize: 13,
                      letterSpacing: 0.3,
                    }}
                  >
                    değiştir
                  </Text>
                </View>
              </Pressable>

              <Pressable
                onPress={onRemove}
                accessibilityRole="button"
                accessibilityLabel="kartı sil"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: palette.coral + '14',
                    borderWidth: 1,
                    borderColor: palette.coral + '33',
                    padding: 10
                  }}
                >
                  <Feather
                    name="trash-2"
                    size={14}
                    color={palette.coral}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: palette.coral,
                      fontSize: 13,
                      letterSpacing: 0.3,
                    }}
                  >
                    sil
                  </Text>
                </View>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            onPress={onAddCard}
            accessibilityRole="button"
            accessibilityLabel={t('payments.add')}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                backgroundColor: palette.coral,
                borderRadius: 24,
                padding: 24,
                aspectRatio: 1.586,
                justifyContent: 'space-between',
                shadowColor: palette.coral,
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.32,
                shadowRadius: 22,
                elevation: 12,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: palette.paper + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="plus" size={28} color={palette.paper} />
              </View>
              <View>
                <Text
                  style={{
                    fontFamily: 'Unbounded_800ExtraBold',
                    color: palette.paper,
                    fontSize: 24,
                    lineHeight: 28,
                    letterSpacing: 0.3,
                  }}
                >
                  kart ekle
                </Text>
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.paper,
                    fontSize: 13,
                    lineHeight: 18,
                    marginTop: 6,
                    opacity: 0.85,
                  }}
                >
                  oynamaya başlamak için kart gerekli. ücretsiz kayıt, dilediğinde kaldır.
                </Text>
              </View>
            </View>
          </Pressable>
        )}

        {/* Trust row — sits under the card to reassure users */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: palette.ink + '08',
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 14,
            marginTop: 18,
          }}
        >
          <Feather name="lock" size={16} color={palette.ink} style={{ marginRight: 10 }} />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            kart bilgilerin iyzico üzerinden saklanır. playbox kart numarana hiçbir zaman erişmez.
          </Text>
        </View>

        {/* Section: history */}
        <SectionLabel>seans geçmişi</SectionLabel>

        <View
          style={{
            borderRadius: 16,
            backgroundColor: palette.ink + '08',
            paddingVertical: 22,
            paddingHorizontal: 18,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 15,
              textAlign: 'center',
            }}
          >
            henüz seans yok
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: 'Unbounded_800ExtraBold',
        color: palette.ink,
        fontSize: 13,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        marginTop: 32,
        marginBottom: 14,
      }}
    >
      {children}
    </Text>
  );
}
