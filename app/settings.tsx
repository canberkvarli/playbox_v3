import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { useT } from '@/hooks/useT';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { AppRatingSheet } from '@/components/AppRatingSheet';
import { BadFeedbackModal } from '@/components/BadFeedbackModal';
import { isBadRating } from '@/lib/feedback';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDevStore } from '@/stores/devStore';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useIsDeveloper } from '@/hooks/useIsDeveloper';
import { getDriver } from '@/lib/hardware';
import { reloadWithBleTeardown } from '@/lib/ble/safeReload';
import { stationClient } from '@/lib/ble/stationClient';

function SettingRow({
  label,
  value,
  onPress,
  destructive,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed && onPress ? 0.6 : 1,
        marginBottom: 10,
      })}
    >
      <View
        style={{
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: 14,
          paddingHorizontal: 16,
          paddingVertical: 16,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: destructive ? palette.danger : palette.fg,
            fontSize: 15,
            letterSpacing: 0.2,
            marginRight: 12,
          }}
        >
          {label}
        </Text>
        {value !== undefined ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: 'Inter_500Medium',
              color: palette.muted,
              fontSize: 13,
              maxWidth: 160,
              marginRight: onPress ? 8 : 0,
            }}
          >
            {value}
          </Text>
        ) : null}
        {onPress ? (
          <Feather name="chevron-right" size={18} color={palette.muted} />
        ) : null}
      </View>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: 'Unbounded_800ExtraBold',
        color: palette.muted,
        fontSize: 12,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginTop: 28,
        marginBottom: 12,
      }}
    >
      {children}
    </Text>
  );
}

function EditModal({
  visible,
  title,
  initial,
  placeholder,
  hint,
  affix,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  placeholder?: string;
  hint?: string;
  affix?: string;
  onSave: (v: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);

  const save = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(value.trim());
      onClose();
    } catch (e) {
      Alert.alert(t('common.error_generic'), String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!value.trim() && !saving;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={() => setValue(initial)}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 26,
              paddingHorizontal: 22,
              paddingTop: 24,
              paddingBottom: 20,
            }}
          >
            <Text
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.fg,
                fontSize: 19,
                lineHeight: 24,
                letterSpacing: 0.3,
                textTransform: 'uppercase',
              }}
            >
              {title}
            </Text>
            {hint ? (
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  color: palette.muted,
                  fontSize: 13,
                  lineHeight: 18,
                  marginTop: 6,
                }}
              >
                {hint}
              </Text>
            ) : null}

            {/* Input — the affix (@ for usernames) shares the bordered field
                so it reads as one control rather than a floating prefix. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 18,
                borderWidth: 1.5,
                borderColor: palette.border,
                borderRadius: 14,
                backgroundColor: palette.surfaceAlt,
                paddingHorizontal: 14,
              }}
            >
              {affix ? (
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.muted,
                    fontSize: 17,
                    marginRight: 1,
                  }}
                >
                  {affix}
                </Text>
              ) : null}
              <TextInput
                value={value}
                onChangeText={setValue}
                placeholder={placeholder}
                placeholderTextColor={palette.muted}
                autoCapitalize={affix ? 'none' : 'words'}
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={save}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  color: palette.fg,
                  fontFamily: 'Inter_600SemiBold',
                  fontSize: 17,
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    paddingVertical: 15,
                    borderRadius: 999,
                    borderWidth: 1.5,
                    borderColor: palette.border,
                    backgroundColor: palette.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_700Bold',
                      color: palette.muted,
                      fontSize: 13,
                    }}
                  >
                    {t('common.cancel')}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={!canSave}
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: !canSave ? 0.45 : pressed ? 0.92 : 1,
                })}
              >
                <View
                  style={{
                    backgroundColor: palette.volt,
                    borderRadius: 999,
                    paddingVertical: 15,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'Unbounded_800ExtraBold',
                      color: palette.voltInk,
                      fontSize: 13,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('common.done')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function formatUpdateTime(d: Date | null): string {
  if (!d) return 'bilinmiyor';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Dev-friendly OTA status. Tells you at a glance which JS is actually
 * running:
 *   - green dot · "OTA güncellemesi aktif" → a downloaded update is live
 *     (shows when it was published + the update id to match against EAS)
 *   - grey dot · "yerleşik sürüm" → running the bundle baked into the build
 *     (no OTA applied — or the last OTA crashed and rolled back)
 *   - grey dot · "geliştirme modu" → __DEV__ / Expo Go, updates disabled
 */
function OtaStatusRow() {
  const devMode = __DEV__ || !Updates.isEnabled;
  // `isEmbeddedLaunch` is the canonical signal: true = build's embedded
  // bundle, false = a downloaded OTA. Short-circuited so we never read it
  // in dev where it isn't meaningful.
  const otaActive = !devMode && !Updates.isEmbeddedLaunch;
  const shortId = (Updates.updateId ?? '').slice(0, 8) || '—';
  const channel = Updates.channel || 'dev';
  const runtime = (Updates.runtimeVersion ?? '—').slice(0, 8);

  const dotColor = otaActive ? palette.volt : palette.muted;
  const title = devMode
    ? 'geliştirme modu · OTA kapalı'
    : otaActive
    ? '✓ OTA güncellemesi aktif'
    : 'yerleşik sürüm · OTA yok';
  const line2 = devMode
    ? null
    : otaActive
    ? `yayınlandı: ${formatUpdateTime(Updates.createdAt)}`
    : 'derlemeyle gelen bundle çalışıyor';

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: otaActive ? palette.volt + '55' : palette.border,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: dotColor,
            marginRight: 10,
          }}
        />
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.fg,
            fontSize: 13,
            letterSpacing: 0.2,
          }}
        >
          {title}
        </Text>
      </View>
      {line2 ? (
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.muted,
            fontSize: 11,
            marginTop: 8,
          }}
        >
          {line2}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: 'JetBrainsMono_500Medium',
          color: palette.muted,
          fontSize: 11,
          marginTop: 4,
        }}
      >
        id: {shortId} · kanal: {channel} · rt: {runtime}
      </Text>
    </View>
  );
}

export default function Settings() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthSession();
  const isDeveloper = useIsDeveloper();
  const { displayName, username, phone } = useDisplayUser();

  const [editField, setEditField] = useState<'name' | 'username' | null>(null);
  const [ratingSheetOpen, setRatingSheetOpen] = useState(false);
  const [badFeedbackRating, setBadFeedbackRating] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhase, setDeletePhase] = useState<'confirm' | 'goodbye'>('confirm');
  const scheme = useSettingsStore((s) => s.scheme);
  const setScheme = useSettingsStore((s) => s.setScheme);
  const setNameOverride = useSettingsStore((s) => s.setNameOverride);
  const setUsernameOverride = useSettingsStore((s) => s.setUsernameOverride);

  const version = Constants.expoConfig?.version ?? '0.0.0';

  const saveName = async (v: string) => {
    setNameOverride(v);
    if (user) {
      try {
        await supabase.auth.updateUser({ data: { name: v } });
      } catch (e) {
        console.warn('[settings] saveName failed', e);
      }
    }
    await hx.yes();
  };
  const saveUsername = async (v: string) => {
    setUsernameOverride(v);
    if (user) {
      try {
        await supabase.auth.updateUser({ data: { username: v } });
      } catch (e) {
        console.warn('[settings] saveUsername failed', e);
      }
    }
    await hx.yes();
  };

  const onPhonePress = async () => {
    await hx.tap();
    Alert.alert(
      t('settings.account.phone_change_title'),
      t('settings.account.phone_change_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.account.phone_change_cta'),
          onPress: () =>
            Linking.openURL('mailto:canberkvarli@gmail.com?subject=Telefon numarası değişikliği').catch(() => {}),
        },
      ]
    );
  };

  const onSignOut = async () => {
    await hx.tap();
    Alert.alert(t('settings.account.signout_title'), t('settings.account.signout_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.account.signout_cta'),
        style: 'destructive',
        onPress: async () => {
          // Purge BLE module state (relay queues+timers, ack cursor, reattach
          // watch, in-flight return, nearby sightings) so nothing leaks into
          // the next account/session. Best-effort — must never block sign-out.
          try {
            getDriver().reset();
          } catch {
            /* ignore — teardown is best-effort */
          }
          // Clear the demo/review session so a reviewer (or you) lands back on
          // the real onboarding, not stuck in Demo Mode.
          useDevStore.getState().setDemoSession(false);
          useDevStore.getState().setDemoMode(false);
          // Clear name/username overrides so the next account doesn't inherit the
          // previous one — e.g. the demo login's "appstore" showing as the real
          // user's username after logging back in with their phone.
          useSettingsStore.getState().setNameOverride(null);
          useSettingsStore.getState().setUsernameOverride(null);
          await supabase.auth.signOut();
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
  };

  const onDelete = async () => {
    await hx.no();
    setDeletePhase('confirm');
    setDeleteOpen(true);
  };

  const onConfirmDelete = async () => {
    // Snap straight to the goodbye state — no jarring Alert pop-up. The
    // network call and signOut run in the background while the user reads
    // the farewell card; we navigate when the dust settles.
    setDeletePhase('goodbye');
    await hx.yes();

    void (async () => {
      try {
        const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
        if (url) {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            await fetch(`${url.replace(/\/$/, '')}/functions/v1/delete-account`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({}),
            }).catch(() => null);
          }
        }
      } finally {
        // Same BLE teardown on account deletion as on sign-out (best-effort).
        try {
          getDriver().reset();
        } catch {
          /* ignore — teardown is best-effort */
        }
        useSettingsStore.getState().setNameOverride(null);
        useSettingsStore.getState().setUsernameOverride(null);
        await supabase.auth.signOut();
      }
    })();

    setTimeout(() => {
      setDeleteOpen(false);
      router.replace('/(onboarding)/welcome');
    }, 1600);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          backgroundColor: palette.paper,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={14}
          accessibilityLabel={t('common.back')}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 24 })}
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
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 14,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          {t('settings.title')}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {/* Profil section */}
        <RiseIn delay={0}>
          <SectionLabel>{t('settings.profile.section')}</SectionLabel>
          <SettingRow
            label={t('settings.profile.name')}
            value={displayName}
            onPress={() => setEditField('name')}
          />
          <SettingRow
            label={t('settings.profile.username')}
            value={`@${username}`}
            onPress={() => setEditField('username')}
          />
        </RiseIn>

        {/* Görünüm — koyu (default) / açık. Light mode uses the orange accent. */}
        <RiseIn delay={40}>
          <SectionLabel>görünüm</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8 }}>
            {([
              { key: 'system', label: 'sistem', icon: 'smartphone' },
              { key: 'light', label: 'açık', icon: 'sun' },
              { key: 'dark', label: 'koyu', icon: 'moon' },
            ] as const).map((opt) => {
              const on = scheme === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={async () => {
                    if (on) return;
                    await hx.tap();
                    setScheme(opt.key);
                  }}
                  style={{
                    flex: 1,
                    height: 56,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    backgroundColor: on ? palette.volt : palette.surface,
                    borderWidth: 1,
                    borderColor: on ? palette.volt : palette.border,
                  }}
                >
                  <Feather
                    name={opt.icon}
                    size={17}
                    color={on ? palette.voltInk : palette.muted}
                  />
                  <Text
                    style={{
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                      color: on ? palette.voltInk : palette.fg,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </RiseIn>

        {/* Hesap section */}
        <RiseIn delay={80}>
          <SectionLabel>{t('settings.account.section')}</SectionLabel>
          <SettingRow
            label={t('settings.account.phone')}
            value={phone}
            onPress={onPhonePress}
          />
          <SettingRow
            label={t('settings.account.signout')}
            onPress={onSignOut}
          />
          <SettingRow
            label={t('settings.account.delete')}
            onPress={onDelete}
            destructive
          />
        </RiseIn>

        {/* Geri bildirim — manual entry to "rate the app". Bad ratings
            chain into the BadFeedbackModal for chips + free text. */}
        <RiseIn delay={120}>
          <SectionLabel>{t('settings.feedback.section')}</SectionLabel>
          <SettingRow
            label={t('settings.feedback.rate_app')}
            onPress={async () => {
              await hx.tap();
              setRatingSheetOpen(true);
            }}
          />
          {/* Developer-only plumbing (OTA status/check/apply, BLE reset + test
              screen). Gated on the DEVELOPER account so it's hidden from real
              users AND App Store / demo reviewers — they only exercise the
              clean flow, never these internals. See useIsDeveloper. */}
          {isDeveloper ? (
          <>
          <OtaStatusRow />
          <SettingRow
            label="Güncellemeyi kontrol et"
            onPress={async () => {
              await hx.tap();
              if (__DEV__ || !Updates.isEnabled) {
                Alert.alert(
                  'Geliştirici modu',
                  `OTA yalnızca release derlemelerinde çalışır.\n\nisEnabled=${Updates.isEnabled}\n__DEV__=${__DEV__}`,
                );
                return;
              }
              try {
                const check: any = await Updates.checkForUpdateAsync();
                if (!check.isAvailable) {
                  Alert.alert(
                    'Güncel',
                    `kanal=${Updates.channel}\nruntime=${Updates.runtimeVersion}\nupdateId=${Updates.updateId ?? 'embedded'}\nreason=${check.reason ?? '?'}\nrollback=${check.isRollBackToEmbedded ?? false}`,
                  );
                  return;
                }
                const fetched: any = await Updates.fetchUpdateAsync();
                Alert.alert(
                  'İndirildi',
                  `Yeniden başlatılıyor…\n\nyeni=${fetched?.manifest?.id?.slice?.(0, 12) ?? '?'}`,
                );
                await reloadWithBleTeardown();
              } catch (e: any) {
                Alert.alert('Güncelleme başarısız', `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`);
              }
            }}
          />
          <SettingRow
            label="Bekleyen güncellemeyi uygula"
            onPress={async () => {
              await hx.tap();
              if (__DEV__ || !Updates.isEnabled) {
                Alert.alert('Geliştirici modu', 'OTA yalnızca release derlemelerinde çalışır.');
                return;
              }
              try {
                await reloadWithBleTeardown();
              } catch (e: any) {
                Alert.alert('Yeniden başlatma başarısız', `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`);
              }
            }}
          />
          {/* Reset the BLE radio in-place: destroys the native BleManager and
              lets it recreate clean on next use — no app reload, no reinstall.
              Recovers a wedged radio (e.g. a connection left scanning) without
              killing the app. */}
          <SettingRow
            label="Bluetooth'u sıfırla"
            onPress={async () => {
              await hx.tap();
              try {
                stationClient.destroy();
                Alert.alert(
                  'Bluetooth sıfırlandı',
                  'Radyo temizlendi ve bir sonraki taramada yeniden kurulacak. Haritaya dönün — uygulamayı silmeye gerek yok.',
                );
              } catch (e: any) {
                Alert.alert('Sıfırlama başarısız', `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`);
              }
            }}
          />
          <SettingRow
            label="dev: BLE test ekranı"
            onPress={async () => {
              await hx.tap();
              router.push('/dev/ble');
            }}
          />
          </>
          ) : null}
        </RiseIn>

        {/* Footer — lives at the natural bottom of the scroll content so it
            never floats over or clips the rows above it. */}
        <View style={{ alignItems: 'center', marginTop: 48 }}>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 12,
            letterSpacing: 4,
            marginBottom: 6,
          }}
        >
          PLAYBOX
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.muted,
            fontSize: 11,
          }}
        >
          {t('settings.about.version')} {version}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Pressable
            onPress={async () => {
              await hx.tap();
              router.push('/legal/privacy');
            }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.muted,
                fontSize: 12,
              }}
            >
              {t('settings.about.privacy')}
            </Text>
          </Pressable>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.border,
              fontSize: 12,
              marginHorizontal: 8,
            }}
          >
            ·
          </Text>
          <Pressable
            onPress={async () => {
              await hx.tap();
              router.push('/legal/terms');
            }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.muted,
                fontSize: 12,
              }}
            >
              {t('settings.about.terms')}
            </Text>
          </Pressable>
        </View>
        </View>
      </ScrollView>

      <EditModal
        visible={editField === 'name'}
        title={t('settings.profile.edit_name')}
        initial={displayName}
        hint={t('settings.profile.edit_name_hint')}
        onSave={saveName}
        onClose={() => setEditField(null)}
      />
      <EditModal
        visible={editField === 'username'}
        title={t('settings.profile.edit_username')}
        initial={username}
        placeholder="mert_42"
        affix="@"
        hint={t('settings.profile.edit_username_hint')}
        onSave={saveUsername}
        onClose={() => setEditField(null)}
      />
      <AppRatingSheet
        visible={ratingSheetOpen}
        onClose={(rating) => {
          setRatingSheetOpen(false);
          // Bad rating? Chain straight into the bad-feedback modal so the
          // user can tell us what specifically went wrong.
          if (isBadRating(rating)) {
            setTimeout(() => setBadFeedbackRating(rating), 240);
          }
        }}
      />
      <BadFeedbackModal
        visible={badFeedbackRating != null}
        rating={badFeedbackRating ?? 0}
        kind="app"
        onClose={() => setBadFeedbackRating(null)}
      />
      <DeleteAccountModal
        visible={deleteOpen}
        phase={deletePhase}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={onConfirmDelete}
      />
    </View>
  );
}

/**
 * Hard-confirmation sheet for account deletion. User types "HOŞÇAKAL" to
 * unlock the destructive button (Apple wants destructive flows that aren't
 * trivially fat-fingerable). After tap, the same sheet swaps to a goodbye
 * card and the parent navigates away — no jarring Alert pop-up.
 */
function DeleteAccountModal({
  visible,
  phase,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  phase: 'confirm' | 'goodbye';
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  // Hold-to-delete — no typing (the old "type HOŞÇAKAL" was painful on English
  // keyboards). Press and hold ~1.5s; a fill sweeps across the button, then it
  // deletes. The deliberate hold is the accident guard.
  const HOLD_MS = 1500;
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);

  const cancelHold = () => {
    if (holdRafRef.current != null) cancelAnimationFrame(holdRafRef.current);
    holdRafRef.current = null;
  };
  const startHold = () => {
    void hx.no();
    holdStartRef.current = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - holdStartRef.current) / HOLD_MS, 1);
      setHoldProgress(p);
      if (p >= 1) {
        cancelHold();
        setHoldProgress(0);
        onConfirm();
      } else {
        holdRafRef.current = requestAnimationFrame(tick);
      }
    };
    holdRafRef.current = requestAnimationFrame(tick);
  };
  const endHold = () => {
    cancelHold();
    setHoldProgress((p) => (p >= 1 ? p : 0));
  };
  useEffect(() => {
    if (!visible) {
      cancelHold();
      setHoldProgress(0);
    }
    return cancelHold;
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <Pressable
        onPress={phase === 'confirm' ? onCancel : undefined}
        style={{
          flex: 1,
          backgroundColor: '#00000080',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: palette.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 36,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 5,
              borderRadius: 3,
              backgroundColor: palette.border,
              marginBottom: 18,
            }}
          />

          {phase === 'goodbye' ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <View
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 42,
                  backgroundColor: palette.surfaceAlt,
                  borderWidth: 1,
                  borderColor: palette.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 22,
                }}
              >
                <Text style={{ fontSize: 40 }}>👋</Text>
              </View>
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.fg,
                  fontSize: 32,
                  lineHeight: 38,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                }}
              >
                hoşçakal
              </Text>
              <Text
                style={{
                  fontFamily: 'Inter_400Regular',
                  color: palette.muted,
                  fontSize: 15,
                  lineHeight: 22,
                  marginTop: 12,
                  textAlign: 'center',
                  paddingHorizontal: 8,
                }}
              >
                hesabın 24 saat içinde silinecek.{'\n'}seninle çalışmak güzeldi.
              </Text>
            </View>
          ) : (
            <>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: palette.danger,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Feather name="alert-triangle" size={28} color={palette.fg} />
          </View>

          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.fg,
              fontSize: 26,
              lineHeight: 31,
              textTransform: 'uppercase',
            }}
          >
            hesabını silmek istediğine emin misin?
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              color: palette.muted,
              fontSize: 14,
              lineHeight: 20,
              marginTop: 10,
            }}
          >
            tüm seans geçmişin, kart bilgilerin, sıralaman silinir. bu işlem geri alınamaz.
          </Text>

          {/* Bullet list */}
          <View
            style={{
              marginTop: 18,
              backgroundColor: palette.danger + '14',
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: palette.danger + '55',
              paddingVertical: 12,
              paddingHorizontal: 14,
            }}
          >
            {[
              'profil ve istatistikler',
              'kayıtlı kart',
              'rezervasyon ve seans geçmişi',
            ].map((line) => (
              <View
                key={line}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 4,
                }}
              >
                <Feather
                  name="x-circle"
                  size={14}
                  color={palette.danger}
                  style={{ marginRight: 10 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Inter_600SemiBold',
                    color: palette.fg,
                    fontSize: 13,
                  }}
                >
                  {line}
                </Text>
              </View>
            ))}
          </View>

          {/* Hold-to-delete instruction */}
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.muted,
              fontSize: 12,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              marginTop: 18,
              marginBottom: 10,
              textAlign: 'center',
            }}
          >
            silmek için basılı tut
          </Text>

          {/* Hold-to-delete CTA — a darker fill sweeps across as you hold; at
              full hold it deletes. No typing required. */}
          <Pressable
            onPressIn={startHold}
            onPressOut={endHold}
            accessibilityRole="button"
            accessibilityLabel="hesabımı sil — silmek için basılı tut"
          >
            <View
              style={{
                backgroundColor: palette.danger,
                borderRadius: 999,
                paddingVertical: 18,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                overflow: 'hidden',
              }}
            >
              {/* Fill grows with the hold. */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.round(holdProgress * 100)}%`,
                  backgroundColor: '#00000038',
                }}
              />
              <Feather name="trash-2" size={20} color={palette.fg} style={{ marginRight: 10 }} />
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.fg,
                  fontSize: 16,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                }}
              >
                {holdProgress > 0 ? 'bırakma…' : 'hesabımı sil'}
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="vazgeç"
            style={({ pressed }) => ({
              marginTop: 14,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                paddingVertical: 14,
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
                  fontSize: 14,
                }}
              >
                vazgeç
              </Text>
            </View>
          </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
