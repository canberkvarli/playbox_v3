import { useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import {
  APP_REASON_KEYS,
  SESSION_REASON_KEYS,
  submitFeedback,
  type FeedbackKind,
} from '@/lib/feedback';

const REASON_KEYS_BY_KIND: Record<FeedbackKind, readonly string[]> = {
  session: SESSION_REASON_KEYS,
  app: APP_REASON_KEYS,
};

const MAX_MESSAGE = 500;

type Props = {
  visible: boolean;
  rating: number;
  kind: FeedbackKind;
  sessionId?: string;
  onClose: () => void;
  onSubmitted?: () => void;
};

/**
 * Modal that pops up when a user gives a low rating (😡 or 😕). Asks them
 * what went wrong via multi-select chips + an optional free-text field.
 *
 * Skipping the modal is fine — the rating itself was already saved by the
 * caller. This modal posts an *additional* feedback row with the reasons
 * + message. We keep the rating in the row so support can correlate.
 */
export function BadFeedbackModal({
  visible,
  rating,
  kind,
  sessionId,
  onClose,
  onSubmitted,
}: Props) {
  const { t } = useT();
  const [reasons, setReasons] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasonKeys = useMemo(() => REASON_KEYS_BY_KIND[kind], [kind]);

  const reset = () => {
    setReasons([]);
    setMessage('');
    setSubmitting(false);
  };

  const dismiss = async () => {
    await hx.tap();
    Keyboard.dismiss();
    reset();
    onClose();
  };

  const toggleReason = async (key: string) => {
    await hx.tap();
    setReasons((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    Keyboard.dismiss();
    await hx.tap();
    const res = await submitFeedback({
      kind,
      rating,
      reasons,
      message,
      sessionId,
    });
    setSubmitting(false);
    reset();
    onSubmitted?.();
    onClose();
    if (res.ok) await hx.yes();
  };

  const titleKey = kind === 'session' ? 'feedback.bad.session.title' : 'feedback.bad.app.title';
  const subKey = kind === 'session' ? 'feedback.bad.session.sub' : 'feedback.bad.app.sub';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}
      >
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
            paddingTop: 26,
            paddingBottom: 22,
            shadowColor: palette.deep,
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 32,
            elevation: 24,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 380 }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.fg,
                fontSize: 22,
                lineHeight: 29,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {t(titleKey)}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                color: palette.muted,
                fontSize: 14,
                lineHeight: 20,
                marginTop: 6,
              }}
            >
              {t(subKey)}
            </Text>

            {/* Quick-pick chips */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 18,
              }}
            >
              {reasonKeys.map((key) => {
                const selected = reasons.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => toggleReason(key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      borderRadius: 12,
                      backgroundColor: selected
                        ? palette.volt
                        : pressed
                        ? palette.surfaceAlt
                        : palette.surfaceAlt,
                      borderWidth: 1.5,
                      borderColor: selected ? palette.volt : palette.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    })}
                  >
                    {selected ? (
                      <Feather name="check" size={13} color={palette.voltInk} />
                    ) : null}
                    <Text
                      style={{
                        fontFamily: 'Unbounded_700Bold',
                        color: selected ? palette.voltInk : palette.fg,
                        fontSize: 12,
                        letterSpacing: 0.2,
                      }}
                    >
                      {t(`feedback.bad.${kind}.reasons.${key}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Free-text */}
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: palette.muted,
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                marginTop: 22,
                marginBottom: 8,
              }}
            >
              {t('feedback.bad.message_label')}
            </Text>
            <TextInput
              value={message}
              onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE))}
              placeholder={t('feedback.bad.message_placeholder')}
              placeholderTextColor={palette.muted}
              multiline
              numberOfLines={3}
              style={{
                fontFamily: 'Inter_400Regular',
                color: palette.fg,
                fontSize: 14,
                lineHeight: 20,
                minHeight: 80,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 14,
                backgroundColor: palette.surfaceAlt,
                borderWidth: 1,
                borderColor: palette.border,
                textAlignVertical: 'top',
              }}
            />
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: palette.muted,
                fontSize: 10,
                marginTop: 4,
                textAlign: 'right',
              }}
            >
              {message.length} / {MAX_MESSAGE}
            </Text>
          </ScrollView>

          {/* Actions */}
          {(() => {
            const disabled =
              submitting || (reasons.length === 0 && message.trim().length === 0);
            return (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 20, alignItems: 'center' }}>
                <Pressable
                  onPress={dismiss}
                  accessibilityRole="button"
                  accessibilityLabel={t('feedback.bad.skip')}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    paddingVertical: 15,
                    paddingHorizontal: 18,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_600SemiBold',
                      color: palette.muted,
                      fontSize: 13,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('feedback.bad.skip')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled }}
                  accessibilityLabel={t('feedback.bad.submit')}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: 16,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: disabled ? palette.surfaceAlt : palette.volt,
                    opacity: pressed && !disabled ? 0.9 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: 'Inter_600SemiBold',
                      color: disabled ? palette.muted : palette.voltInk,
                      fontSize: 14,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {submitting ? t('feedback.bad.submitting') : t('feedback.bad.submit')}
                  </Text>
                </Pressable>
              </View>
            );
          })()}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
