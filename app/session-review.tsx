import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { useSessionStore } from '@/stores/sessionStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useIyzico } from '@/lib/iyzico';
import { SPORT_LABELS } from '@/data/stations.seed';
import { SPORT_EMOJI } from '@/data/sports';
import { PostSessionCardPrompt } from '@/components/PostSessionCardPrompt';
import { BadFeedbackModal } from '@/components/BadFeedbackModal';
import { costForMinutes } from '@/lib/pricing';
import { isBadRating, submitFeedback } from '@/lib/feedback';

const FACES = ['😡', '😕', '😐', '🙂', '🤩'] as const;

export default function SessionReview() {
  const insets = useSafeAreaInsets();
  const lastEnded = useSessionStore((s) => s.lastEnded);
  const acknowledgeEnded = useSessionStore((s) => s.acknowledgeEnded);

  const cardStatus = usePaymentStore((s) => s.cardStatus);
  const freeFirstUsed = usePaymentStore((s) => s.freeFirstUsed);
  const markFreeFirstUsed = usePaymentStore((s) => s.markFreeFirstUsed);
  const currentHoldId = usePaymentStore((s) => s.currentHoldId);
  const clearHold = usePaymentStore((s) => s.setHold);
  const { captureHold, releaseHold } = useIyzico();

  const [rating, setRating] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [cardPromptDismissed, setCardPromptDismissed] = useState(false);
  const sideEffectsRan = useRef(false);

  useEffect(() => {
    if (sideEffectsRan.current || !lastEnded) return;
    sideEffectsRan.current = true;

    if (cardStatus === 'none' && !freeFirstUsed) {
      markFreeFirstUsed();
    }

    const holdId = lastEnded.holdId ?? currentHoldId;
    if (holdId) {
      // Capture the actual cost for the played minutes — Iyzico releases
      // the difference between the preauth amount and the captured amount
      // automatically. Previously we were calling releaseHold() here, which
      // cancelled the entire preauth and gave the user a free session.
      const elapsedMs = lastEnded.endedAt - lastEnded.startedAt;
      const elapsedMin = Math.max(1, Math.ceil(elapsedMs / 60_000));
      const amountTry = costForMinutes(elapsedMin);
      const free = cardStatus === 'none' && !freeFirstUsed;
      const action = free ? releaseHold(holdId) : captureHold(holdId, amountTry);
      action.finally(() => clearHold(null));
    }
  }, [lastEnded, cardStatus, freeFirstUsed, markFreeFirstUsed, captureHold, releaseHold, clearHold, currentHoldId]);

  const showCardPrompt = lastEnded && cardStatus === 'none' && !cardPromptDismissed;

  const goHome = () => {
    acknowledgeEnded();
    router.dismissAll();
    setTimeout(() => router.replace('/(tabs)/map'), 50);
  };

  if (!lastEnded) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'Unbounded_700Bold', color: palette.ink, fontSize: 16 }}>
          yükleniyor...
        </Text>
      </View>
    );
  }

  const elapsedMs = lastEnded.endedAt - lastEnded.startedAt;
  const elapsedMin = Math.max(1, Math.ceil(elapsedMs / 60_000));
  const total = costForMinutes(elapsedMin);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.paper,
        paddingTop: insets.top + 40,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
    >
      {/* Hero */}
      <RiseIn delay={0}>
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: palette.coral,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="check" size={40} color={palette.paper} />
          </View>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 34,
              lineHeight: 38,
              textAlign: 'center',
              marginTop: 20,
            }}
          >
            seans{'\n'}tamamlandı
          </Text>
        </View>
      </RiseIn>

      {/* Summary */}
      <RiseIn delay={120}>
        <View
          style={{
            backgroundColor: palette.butter,
            borderRadius: 24,
            padding: 20,
            marginTop: 32,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Text style={{ fontSize: 36 }}>{SPORT_EMOJI[lastEnded.sport]}</Text>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  fontSize: 18,
                  lineHeight: 22,
                }}
              >
                {lastEnded.stationName}
              </Text>
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  color: palette.ink + '99',
                  fontSize: 12,
                  marginTop: 2,
                }}
              >
                {SPORT_LABELS[lastEnded.sport]}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: palette.ink + '14', marginVertical: 16 }} />

          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.ink,
                  fontSize: 28,
                }}
              >
                {elapsedMin}
              </Text>
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  color: palette.ink + '99',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                dakika
              </Text>
            </View>
            <View style={{ width: 1, backgroundColor: palette.ink + '14' }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.ink,
                  fontSize: 28,
                }}
              >
                ₺{total}
              </Text>
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  color: palette.ink + '99',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                toplam
              </Text>
            </View>
          </View>
        </View>
      </RiseIn>

      {/* Quick rating */}
      <RiseIn delay={220}>
        <View style={{ marginTop: 32 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 18,
              textAlign: 'center',
            }}
          >
            nasıldı?
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 14,
              marginTop: 16,
            }}
          >
            {FACES.map((face, i) => {
              const active = rating === i;
              return (
                <Pressable
                  key={face}
                  onPress={async () => {
                    await hx.tap();
                    setRating(i);
                    // Save the rating immediately — fire and forget so the
                    // UI never waits on the network.
                    submitFeedback({ kind: 'session', rating: i }).catch(() => {});
                    // For 😡 / 😕, open the bad-feedback modal so we can
                    // capture WHY. The modal posts a separate row with
                    // reasons + message.
                    if (isBadRating(i)) {
                      setTimeout(() => setFeedbackOpen(true), 240);
                    }
                  }}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.8 : 1,
                    transform: [{ scale: active ? 1.1 : 1 }],
                    marginHorizontal: 4,
                  })}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? palette.coral + '22' : palette.ink + '0d',
                      borderWidth: 1.5,
                      borderColor: active ? palette.coral : palette.ink + '22',
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{face}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </RiseIn>

      {showCardPrompt ? (
        <PostSessionCardPrompt onSkip={() => setCardPromptDismissed(true)} />
      ) : null}

      <View style={{ flex: 1 }} />

      {/* CTA */}
      <RiseIn delay={300}>
        <Pressable
          onPress={goHome}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.coral,
              borderRadius: 24,
              paddingVertical: 22,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: palette.coral,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.32,
              shadowRadius: 18,
              elevation: 12,
            }}
          >
            <Feather name="map" size={20} color={palette.paper} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.paper,
                fontSize: 20,
                letterSpacing: 1,
              }}
            >
              haritaya dön
            </Text>
          </View>
        </Pressable>
      </RiseIn>

      <BadFeedbackModal
        visible={feedbackOpen}
        rating={rating ?? 0}
        kind="session"
        onClose={() => setFeedbackOpen(false)}
      />
    </View>
  );
}
