import { useState } from 'react';
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

// Safe-import expo-image-picker the same way scan.tsx safe-imports
// expo-camera — keeps the bundle from exploding if the native module isn't
// linked in some build, and lets the sheet degrade to text-only.
let ImagePicker: any = null;
try {
  ImagePicker = require('expo-image-picker');
} catch {}

import { useT } from '@/hooks/useT';
import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { GEAR_REPORT_KINDS, type GearReportKind } from '@/lib/gear/report';
import { uploadReturnPhoto } from '@/lib/gear/uploadReturnPhoto';
import { submitGearReport } from '@/lib/gear/submitGearReport';

const MAX_MESSAGE = 500;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Session context — all optional; the report still posts without them. */
  bleSessionId?: string | null;
  stationId?: string | null;
  gate?: number | null;
};

type Status = 'idle' | 'submitting' | 'ok' | 'error';

/**
 * Bottom-sheet for "bir sorun bildir" — lets the user flag lost / damaged /
 * wrong / other gear, with an optional note and an optional photo.
 *
 * Everything here is BEST-EFFORT: a failed photo upload still submits the
 * report (minus the photo, with a soft warning); a failed insert shows an
 * error toast but never crashes. Opening/closing this sheet must never
 * disturb the underlying session flow.
 */
export function GearReportSheet({
  visible,
  onClose,
  bleSessionId,
  stationId,
  gate,
}: Props) {
  const { t } = useT();
  const [kind, setKind] = useState<GearReportKind>('lost');
  const [message, setMessage] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [softWarn, setSoftWarn] = useState(false);

  const reset = () => {
    setKind('lost');
    setMessage('');
    setPhotoUri(null);
    setPhotoBase64(null);
    setStatus('idle');
    setSoftWarn(false);
  };

  const dismiss = async () => {
    await hx.tap();
    Keyboard.dismiss();
    reset();
    onClose();
  };

  const pickPhoto = async () => {
    await hx.tap();
    if (!ImagePicker) return; // module missing → silently no-op (text-only)
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync?.();
      // If camera is denied, fall back to the library so the user still has a
      // way to attach something. Both are optional.
      const launch =
        perm && perm.granted === false
          ? ImagePicker.launchImageLibraryAsync
          : ImagePicker.launchCameraAsync;
      const res = await launch({
        mediaTypes: 'images',
        quality: 0.6,
        base64: true,
        allowsEditing: false,
      });
      if (res?.canceled) return;
      const asset = res?.assets?.[0];
      if (!asset) return;
      setPhotoUri(asset.uri ?? null);
      setPhotoBase64(asset.base64 ?? null);
      await hx.tap();
    } catch {
      // Pickers throw on some OEMs; swallow — photo stays optional.
    }
  };

  const submit = async () => {
    if (status === 'submitting') return;
    setStatus('submitting');
    setSoftWarn(false);
    Keyboard.dismiss();
    await hx.tap();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      if (!userId) {
        setStatus('error');
        return;
      }

      // A photo needs a session id to key its per-user object path; when we
      // lack one we synthesize a stable report id so the upload still has a
      // home. The pure orchestration drives the rest (best-effort photo →
      // build+validate → insert) and is unit-tested in submitGearReport.test.ts.
      const sid = bleSessionId ?? `report-${Date.now()}`;
      const photoUriToUpload = photoBase64 ?? photoUri ?? null;

      const res = await submitGearReport(
        {
          uploadPhoto: (u, s, f) => uploadReturnPhoto(supabase, u, s, f),
          insertReport: async (row) => {
            const { error } = await supabase.from('gear_reports').insert(row);
            if (error) {
              if (__DEV__) console.warn('[gear_reports] insert failed', error);
              return { ok: false, error: error.message };
            }
            return { ok: true };
          },
        },
        {
          userId,
          bleSessionId: bleSessionId ?? null,
          photoSessionId: sid,
          stationId: stationId ?? null,
          gate: gate ?? null,
          kind,
          message,
          photoUri: photoUriToUpload,
        },
      );

      if (!res.ok) {
        setStatus('error');
        return;
      }
      // Soft warning: the report went through, but the photo couldn't attach.
      if (res.photoFailed) setSoftWarn(true);

      await hx.yes();
      setStatus('ok');
      // Auto-dismiss shortly after success so the user sees the confirmation.
      setTimeout(() => {
        reset();
        onClose();
      }, 1100);
    } catch (e) {
      if (__DEV__) console.warn('[gear_reports] submit threw', e);
      setStatus('error');
    }
  };

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
          accessibilityLabel={t('common.cancel')}
          style={{ flex: 1, backgroundColor: '#00000088' }}
        />

        <View
          style={{
            backgroundColor: palette.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderTopWidth: 1,
            borderColor: palette.border,
            paddingHorizontal: 22,
            paddingTop: 14,
            paddingBottom: 28,
            shadowColor: palette.deep,
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.4,
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
              backgroundColor: palette.border,
              marginBottom: 14,
            }}
          />

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 520 }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.fg,
                fontSize: 22,
                lineHeight: 26,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {t('gear.report.title')}
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
              {t('gear.report.sub')}
            </Text>

            {/* Kind picker */}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 18,
              }}
            >
              {GEAR_REPORT_KINDS.map((k) => {
                const selected = kind === k;
                return (
                  <Pressable
                    key={k}
                    onPress={async () => {
                      await hx.tap();
                      setKind(k);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    {/* Visuals live on this STATIC inner View. Function-form
                        Pressable styles are dropped on this RN build, which was
                        erasing every chip's background + border and making the
                        options read as plain bold text instead of buttons. */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 15,
                        paddingVertical: 11,
                        borderRadius: 999,
                        backgroundColor: selected ? palette.volt : palette.surfaceAlt,
                        borderWidth: 1.5,
                        borderColor: selected ? palette.volt : palette.border,
                      }}
                    >
                      {selected ? (
                        <Feather name="check" size={13} color={palette.voltInk} />
                      ) : null}
                      <Text
                        style={{
                          fontFamily: 'Inter_600SemiBold',
                          color: selected ? palette.voltInk : palette.fg,
                          fontSize: 13.5,
                          letterSpacing: 0.2,
                        }}
                      >
                        {t(`gear.kind.${k}`)}
                      </Text>
                    </View>
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
              {t('gear.report.message_label')}
            </Text>
            <TextInput
              value={message}
              onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE))}
              placeholder={t('gear.report.message_placeholder')}
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

            {/* Optional photo */}
            {ImagePicker ? (
              <Pressable
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel={t('gear.report.add_photo')}
                style={({ pressed }) => ({ marginTop: 16, opacity: pressed ? 0.7 : 1 })}
              >
                {/* Static inner View so the bordered pill actually renders
                    (function-form Pressable styles are dropped on this build). */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    borderRadius: 14,
                    backgroundColor: palette.surfaceAlt,
                    borderWidth: 1.5,
                    borderColor: photoUri ? palette.volt : palette.border,
                  }}
                >
                  <Feather
                    name={photoUri ? 'check-circle' : 'camera'}
                    size={16}
                    color={photoUri ? palette.volt : palette.fg}
                  />
                  <Text
                    style={{
                      fontFamily: 'Inter_600SemiBold',
                      color: palette.fg,
                      fontSize: 13.5,
                    }}
                  >
                    {photoUri ? t('gear.report.photo_added') : t('gear.report.add_photo')}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            {softWarn ? (
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.danger,
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {t('gear.report.photo_failed')}
              </Text>
            ) : null}

            {status === 'error' ? (
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.danger,
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {t('gear.report.error')}
              </Text>
            ) : null}
            {status === 'ok' ? (
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.voltText,
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {t('gear.report.success')}
              </Text>
            ) : null}
          </ScrollView>

          {/* Actions — flex lives on the static outer wrappers and the pill
              visuals on static inner Views, because function-form Pressable
              styles (flex + background + border) are dropped on this RN build.
              That drop was why İPTAL/GÖNDER rendered as bare text, not buttons. */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <View style={{ flex: 1 }}>
              <Pressable
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View
                  style={{
                    paddingVertical: 15,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: palette.surfaceAlt,
                    borderWidth: 1.5,
                    borderColor: palette.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: palette.muted,
                      fontSize: 13,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('common.cancel')}
                  </Text>
                </View>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Pressable
                onPress={submit}
                disabled={status === 'submitting' || status === 'ok'}
                accessibilityRole="button"
                accessibilityLabel={t('gear.report.submit')}
                style={({ pressed }) => ({
                  opacity:
                    status === 'submitting' || status === 'ok' ? 0.5 : pressed ? 0.9 : 1,
                })}
              >
                <View
                  style={{
                    paddingVertical: 15,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: palette.volt,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_800ExtraBold',
                      color: palette.voltInk,
                      fontSize: 13,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                    }}
                  >
                    {status === 'submitting'
                      ? t('gear.report.submitting')
                      : t('gear.report.submit')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
