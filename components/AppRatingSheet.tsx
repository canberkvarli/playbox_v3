import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';

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
    await hx.success();
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
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={dismiss}
          accessibilityLabel="kapat"
          style={{ flex: 1, backgroundColor: '#00000088' }}
        />
        <View
          style={{
            backgroundColor: palette.paper,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 22,
            paddingTop: 14,
            paddingBottom: 28 + (Platform.OS === 'ios' ? 12 : 0),
            shadowColor: palette.ink,
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.18,
            shadowRadius: 24,
            elevation: 24,
          }}
        >
          {/* drag handle */}
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 4,
              borderRadius: 2,
              backgroundColor: palette.ink + '22',
              marginBottom: 14,
            }}
          />

          {!thanksVisible ? (
            <>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.ink,
                  fontSize: 22,
                  lineHeight: 26,
                  textAlign: 'center',
                }}
              >
                {t('feedback.app_prompt.title')}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.ink + 'cc',
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
                          backgroundColor: active ? palette.coral + '22' : palette.ink + '0d',
                          borderWidth: 1.5,
                          borderColor: active ? palette.coral : palette.ink + '22',
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
                    fontFamily: 'Unbounded_700Bold',
                    color: palette.ink + 'aa',
                    fontSize: 12,
                    letterSpacing: 0.3,
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
                  color: palette.ink,
                  fontSize: 18,
                  marginTop: 10,
                }}
              >
                {t('feedback.app_prompt.thanks_title')}
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.ink + 'cc',
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
