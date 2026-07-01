import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '@/hooks/useT';
import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import { isBadRating, submitFeedback } from '@/lib/feedback';

const FACES = ['😡', '😕', '😐', '🙂', '🤩'] as const;

type Props = {
  visible: boolean;
  /** Called with the chosen rating, or `null` if the user dismissed.
   *  When the rating is "bad" (<= 1) the parent should open
   *  <BadFeedbackModal kind="app" rating={...} /> next. */
  onClose: (rating: number | null) => void;
};

/**
 * Standalone "rate the app" prompt. Shows 5 faces; on tap saves a
 * baseline `kind='app'` row and hands control back to the parent so it
 * can chain a follow-up bad-feedback modal when warranted.
 *
 * For ratings >= 2 we briefly show a "thanks" beat then auto-close.
 */
export function AppRatingSheet({ visible, onClose }: Props) {
  const { t } = useT();
  const [rating, setRating] = useState<number | null>(null);
  const [thanksVisible, setThanksVisible] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setRating(null);
      setThanksVisible(false);
      closingRef.current = false;
    }
  }, [visible]);

  const dismiss = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    await hx.tap();
    onClose(null);
  };

  const onPickRating = async (i: number) => {
    if (closingRef.current) return;
    await hx.tap();
    setRating(i);
    submitFeedback({ kind: 'app', rating: i }).catch(() => {});

    if (isBadRating(i)) {
      // Hand back so the parent can open the bad-feedback modal.
      closingRef.current = true;
      setTimeout(() => onClose(i), 220);
      return;
    }

    // Good or neutral rating — show a quick thank-you, then close.
    await hx.yes();
    setThanksVisible(true);
    setTimeout(() => {
      closingRef.current = true;
      onClose(i);
    }, 1400);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <Pressable
          onPress={dismiss}
          accessibilityLabel="kapat"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#00000099' }]}
        />
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: 28,
            borderWidth: 1,
            borderColor: palette.border,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 22,
            shadowColor: palette.deep,
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 32,
            elevation: 24,
          }}
        >
          {!thanksVisible ? (
            <>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.fg,
                  fontSize: 22,
                  lineHeight: 29,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  textAlign: 'center',
                }}
              >
                {t('feedback.app_prompt.title')}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  color: palette.muted,
                  fontSize: 14,
                  lineHeight: 20,
                  marginTop: 8,
                  textAlign: 'center',
                }}
              >
                {t('feedback.app_prompt.sub')}
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 12,
                  marginTop: 24,
                }}
              >
                {FACES.map((face, i) => {
                  const active = rating === i;
                  return (
                    <Pressable
                      key={face}
                      onPress={() => onPickRating(i)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.8 : 1,
                        transform: [{ scale: active ? 1.1 : 1 }],
                      })}
                      accessibilityRole="button"
                      accessibilityLabel={`${i + 1} / 5`}
                    >
                      <View
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 28,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: active ? palette.volt + '22' : palette.surfaceAlt,
                          borderWidth: 1.5,
                          borderColor: active ? palette.volt : palette.border,
                        }}
                      >
                        <Text style={{ fontSize: 28 }}>{face}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={t('feedback.app_prompt.dismiss')}
                hitSlop={10}
                style={({ pressed }) => ({
                  alignSelf: 'center',
                  marginTop: 22,
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.muted,
                    fontSize: 12,
                    letterSpacing: 1.2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('feedback.app_prompt.dismiss')}
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 18 }}>
              <Text style={{ fontSize: 36 }}>🙏</Text>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.fg,
                  fontSize: 18,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginTop: 10,
                }}
              >
                {t('feedback.app_prompt.thanks_title')}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  color: palette.muted,
                  fontSize: 13,
                  marginTop: 4,
                  textAlign: 'center',
                }}
              >
                {t('feedback.app_prompt.thanks_sub')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
