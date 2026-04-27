import { useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
    if (res.ok) await hx.success();
  };

  const titleKey = kind === 'session' ? 'feedback.bad.session.title' : 'feedback.bad.app.title';
  const subKey = kind === 'session' ? 'feedback.bad.session.sub' : 'feedback.bad.app.sub';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
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
            paddingBottom: 28,
            shadowColor: palette.ink,
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.18,
            shadowRadius: 24,
            elevation: 24,
          }}
        >
          {/* Drag handle */}
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

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 22,
                lineHeight: 26,
              }}
            >
              {t(titleKey)}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink + 'cc',
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
                      paddingVertical: 10,
                      borderRadius: 12,
                      backgroundColor: selected ? palette.ink : palette.ink + '0d',
                      borderWidth: 1,
                      borderColor: selected ? palette.ink : palette.ink + '14',
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    })}
                  >
                    {selected ? (
                      <Feather name="check" size={13} color={palette.paper} />
                    ) : null}
                    <Text
                      style={{
                        fontFamily: 'Unbounded_700Bold',
                        color: selected ? palette.paper : palette.ink,
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
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink + '99',
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
              placeholderTextColor={palette.ink + '66'}
              multiline
              numberOfLines={3}
              style={{
                fontFamily: 'Inter_400Regular',
                color: palette.ink,
                fontSize: 14,
                lineHeight: 20,
                minHeight: 80,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 14,
                backgroundColor: palette.ink + '08',
                borderWidth: 1,
                borderColor: palette.ink + '14',
                textAlignVertical: 'top',
              }}
            />
            <Text
              style={{
                fontFamily: 'JetBrainsMono_500Medium',
                color: palette.ink + '66',
                fontSize: 10,
                marginTop: 4,
                textAlign: 'right',
              }}
            >
              {message.length} / {MAX_MESSAGE}
            </Text>
          </ScrollView>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={t('feedback.bad.skip')}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.ink + '0d',
                borderWidth: 1,
                borderColor: palette.ink + '14',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  fontSize: 13,
                  letterSpacing: 0.3,
                }}
              >
                {t('feedback.bad.skip')}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={submitting || (reasons.length === 0 && message.trim().length === 0)}
              accessibilityRole="button"
              accessibilityLabel={t('feedback.bad.submit')}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.ink,
                opacity:
                  submitting || (reasons.length === 0 && message.trim().length === 0)
                    ? 0.4
                    : pressed
                    ? 0.85
                    : 1,
              })}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 13,
                  letterSpacing: 0.3,
                }}
              >
                {submitting ? t('feedback.bad.submitting') : t('feedback.bad.submit')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
