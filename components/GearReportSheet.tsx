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
import {
  GEAR_REPORT_KINDS,
  buildGearReportRow,
  type GearReportKind,
} from '@/lib/gear/report';
import { uploadReturnPhoto } from '@/lib/gear/uploadReturnPhoto';

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

      // Best-effort photo upload FIRST. If it fails we keep going without a
      // photo_path and flag a soft warning to the user.
      let photoPath: string | null = null;
      if (photoBase64 || photoUri) {
        const sid = bleSessionId ?? `report-${Date.now()}`;
        const src = photoBase64 ?? photoUri!;
        const up = await uploadReturnPhoto(supabase, userId, sid, src);
        if (up.ok) photoPath = up.path;
        else setSoftWarn(true);
      }

      const built = buildGearReportRow({
        userId,
        bleSessionId: bleSessionId ?? null,
        stationId: stationId ?? null,
        gate: gate ?? null,
        kind,
        message,
        photoPath,
      });
      if (!built.ok) {
        setStatus('error');
        return;
      }

      const { error } = await supabase.from('gear_reports').insert(built.row);
      if (error) {
        if (__DEV__) console.warn('[gear_reports] insert failed', error);
        setStatus('error');
        return;
      }

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
            style={{ maxHeight: 520 }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 22,
                lineHeight: 26,
              }}
            >
              {t('gear.report.title')}
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
                      {t(`gear.kind.${k}`)}
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
              {t('gear.report.message_label')}
            </Text>
            <TextInput
              value={message}
              onChangeText={(v) => setMessage(v.slice(0, MAX_MESSAGE))}
              placeholder={t('gear.report.message_placeholder')}
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

            {/* Optional photo */}
            {ImagePicker ? (
              <Pressable
                onPress={pickPhoto}
                accessibilityRole="button"
                accessibilityLabel={t('gear.report.add_photo')}
                style={({ pressed }) => ({
                  marginTop: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: palette.ink + '08',
                  borderWidth: 1,
                  borderColor: palette.ink + '14',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Feather
                  name={photoUri ? 'check-circle' : 'camera'}
                  size={16}
                  color={palette.ink}
                />
                <Text
                  style={{
                    fontFamily: 'Unbounded_700Bold',
                    color: palette.ink,
                    fontSize: 12,
                  }}
                >
                  {photoUri ? t('gear.report.photo_added') : t('gear.report.add_photo')}
                </Text>
              </Pressable>
            ) : null}

            {softWarn ? (
              <Text
                style={{
                  fontFamily: 'Inter_600SemiBold',
                  color: palette.coral,
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
                  color: palette.coral,
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
                  color: palette.ink,
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {t('gear.report.success')}
              </Text>
            ) : null}
          </ScrollView>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
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
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={status === 'submitting' || status === 'ok'}
              accessibilityRole="button"
              accessibilityLabel={t('gear.report.submit')}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.ink,
                opacity:
                  status === 'submitting' || status === 'ok'
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
                {status === 'submitting'
                  ? t('gear.report.submitting')
                  : t('gear.report.submit')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
