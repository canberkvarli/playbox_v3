import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { useSessionStore } from '@/stores/sessionStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useIyzico } from '@/lib/iyzico';
import { SPORT_EMOJI } from '@/data/sports';
import { PostSessionCardPrompt } from '@/components/PostSessionCardPrompt';
import { BadFeedbackModal } from '@/components/BadFeedbackModal';
import { AppRatingSheet } from '@/components/AppRatingSheet';
import { GearReportSheet } from '@/components/GearReportSheet';
import { costForMinutes } from '@/lib/pricing';
import { isBadRating } from '@/lib/feedback';
import { useT } from '@/hooks/useT';

export default function SessionReview() {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const lastEnded = useSessionStore((s) => s.lastEnded);
  const acknowledgeEnded = useSessionStore((s) => s.acknowledgeEnded);

  const cardStatus = usePaymentStore((s) => s.cardStatus);
  const freeFirstUsed = usePaymentStore((s) => s.freeFirstUsed);
  const markFreeFirstUsed = usePaymentStore((s) => s.markFreeFirstUsed);
  const currentHoldId = usePaymentStore((s) => s.currentHoldId);
  const clearHold = usePaymentStore((s) => s.setHold);
  const { captureHold, releaseHold } = useIyzico();

  const [rating, setRating] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false); // bad-rating reasons modal
  const [ratingOpen, setRatingOpen] = useState(false); // emoji rating modal
  const ratingDoneRef = useRef(false);
  const [cardPromptDismissed, setCardPromptDismissed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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

  // Leaving the review (card "sonra" or "haritaya dön") offers the emoji rating
  // once, as a modal. Skipping it (backdrop/close) still returns to the map.
  const openRatingOrLeave = () => {
    if (ratingDoneRef.current) {
      goHome();
      return;
    }
    setRatingOpen(true);
  };

  const onRatingClose = (r: number | null) => {
    ratingDoneRef.current = true;
    setRatingOpen(false);
    // Bad rating → chain the reasons modal, then leave from there.
    if (isBadRating(r)) {
      setRating(r);
      setTimeout(() => setFeedbackOpen(true), 240);
      return;
    }
    goHome();
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
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.paper }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 48,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      showsVerticalScrollIndicator={false}
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
              fontSize: 30,
              lineHeight: 35,
              textAlign: 'center',
              marginTop: 22,
            }}
          >
            seans{'\n'}tamamlandı
          </Text>

          {/* Iade onaylandı badge — only when the firmware's gate_closed
              event arrived for this session. Tiny, unobtrusive: just a
              receipt that the station physically registered the door
              close, not an interactive element. */}
          {lastEnded.returnConfirmed ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 14,
                backgroundColor: palette.surface + '0d',
                borderWidth: 1,
                borderColor: palette.ink + '22',
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Feather
                name="check-circle"
                size={12}
                color={palette.ink}
                style={{ marginRight: 6 }}
              />
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_700Bold',
                  fontSize: 10,
                  letterSpacing: 1.5,
                  color: palette.ink,
                  textTransform: 'uppercase',
                }}
              >
                iade onaylandı
              </Text>
            </View>
          ) : null}
        </View>
      </RiseIn>

      {/* Summary — slim, chrome-less: sport · station + one mono stat line.
          (Was a bordered card with a divider and two big 28px stats — too heavy,
          and "₺0 toplam" was meaningless for free/demo sessions.) */}
      <RiseIn delay={120}>
        <View
          style={{
            marginTop: 24,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ fontSize: 26 }}>{SPORT_EMOJI[lastEnded.sport]}</Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 17,
              lineHeight: 21,
            }}
          >
            {lastEnded.stationName}
          </Text>
        </View>
        <Text
          style={{
            textAlign: 'center',
            marginTop: 8,
            fontFamily: 'JetBrainsMono_400Regular',
            color: palette.ink + '99',
            fontSize: 13,
            letterSpacing: 0.3,
          }}
        >
          {`${elapsedMin} dakika · ${Number(total) > 0 ? `₺${total}` : 'ücretsiz'}`}
        </Text>
      </RiseIn>


      {showCardPrompt ? (
        <PostSessionCardPrompt
          onSkip={() => {
            setCardPromptDismissed(true);
            // "sonra" no longer just vanishes — pop the rating modal.
            openRatingOrLeave();
          }}
        />
      ) : null}

      {/* Report-a-problem. Skippable — the screen finishes via
          "haritaya dön" regardless. */}
      <RiseIn delay={260}>
        <View style={{ marginTop: 28, marginBottom: 24, alignItems: 'center' }}>
          <Pressable
            onPress={async () => {
              await hx.tap();
              setReportOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('gear.report.title')}
            hitSlop={8}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink + 'aa',
                fontSize: 13,
                textDecorationLine: 'underline',
              }}
            >
              {t('gear.report.title')}
            </Text>
          </Pressable>
        </View>
      </RiseIn>

      <View style={{ flex: 1, minHeight: 12 }} />

      {/* CTA */}
      <RiseIn delay={300}>
        <Pressable
          onPress={openRatingOrLeave}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <View
            style={{
              backgroundColor: palette.volt,
              borderRadius: 999,
              paddingVertical: 20,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              shadowColor: palette.volt,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.2,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Feather name="map" size={20} color={palette.voltInk} style={{ marginRight: 10 }} />
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.voltInk,
                fontSize: 19,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              haritaya dön
            </Text>
          </View>
        </Pressable>
      </RiseIn>

      {/* Emoji rating — now a modal, popped when the user leaves the review
          (card "sonra" or "haritaya dön"). Closing/skipping returns to the map. */}
      <AppRatingSheet
        visible={ratingOpen}
        kind="session"
        title="nasıldı?"
        sub="bu seans nasıl geçti?"
        onClose={onRatingClose}
      />

      <BadFeedbackModal
        visible={feedbackOpen}
        rating={rating ?? 0}
        kind="session"
        onClose={() => {
          setFeedbackOpen(false);
          goHome();
        }}
      />

      <GearReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        bleSessionId={lastEnded.bleSessionId ?? null}
        stationId={lastEnded.stationId ?? null}
        gate={lastEnded.gate ?? null}
      />
    </ScrollView>
  );
}
