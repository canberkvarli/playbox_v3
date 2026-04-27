import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
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

import { useT } from '@/hooks/useT';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { AppRatingSheet } from '@/components/AppRatingSheet';
import { BadFeedbackModal } from '@/components/BadFeedbackModal';
import { isBadRating } from '@/lib/feedback';
import { useSettingsStore } from '@/stores/settingsStore';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/hooks/useAuthSession';

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
          backgroundColor: palette.paper,
          borderWidth: 1.5,
          borderColor: palette.ink + '22',
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
            color: destructive ? palette.coral : palette.ink,
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
              fontFamily: 'Inter_700Bold',
              color: palette.ink,
              fontSize: 13,
              maxWidth: 160,
              opacity: 0.7,
              marginRight: onPress ? 8 : 0,
            }}
          >
            {value}
          </Text>
        ) : null}
        {onPress ? (
          <Feather name="chevron-right" size={18} color={palette.ink} />
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
        color: palette.ink,
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
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial: string;
  placeholder?: string;
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={() => setValue(initial)}
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          paddingHorizontal: 28,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: palette.paper,
            borderRadius: 22,
            padding: 22,
          }}
        >
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 22,
              lineHeight: 26,
            }}
          >
            {title}
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={palette.ink + 'aa'}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={{
              marginTop: 16,
              borderWidth: 2,
              borderColor: palette.ink + '22',
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 14,
              color: palette.ink,
              fontFamily: 'Inter_600SemiBold',
              fontSize: 17,
              backgroundColor: palette.paper,
            }}
          />
          <View style={{ flexDirection: 'row', marginTop: 18 }}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                flex: 1,
                marginRight: 10,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  paddingVertical: 14,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: palette.ink + '22',
                  backgroundColor: palette.ink + '0d',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_700Bold',
                    color: palette.ink,
                    fontSize: 14,
                  }}
                >
                  {t('common.cancel')}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={saving}
              style={({ pressed }) => ({
                flex: 1,
                opacity: saving ? 0.6 : pressed ? 0.92 : 1,
              })}
            >
              <View
                style={{
                  backgroundColor: palette.coral,
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                  shadowColor: palette.coral,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.25,
                  shadowRadius: 12,
                  elevation: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: 'Unbounded_700Bold',
                    color: palette.paper,
                    fontSize: 14,
                  }}
                >
                  {t('common.done')}
                </Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function Settings() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthSession();
  const { displayName, username, phone } = useDisplayUser();

  const [editField, setEditField] = useState<'name' | 'username' | null>(null);
  const [ratingSheetOpen, setRatingSheetOpen] = useState(false);
  const [badFeedbackRating, setBadFeedbackRating] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
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
            Linking.openURL('mailto:destek@playbox.app?subject=Telefon numarası değişikliği').catch(() => {}),
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
          await supabase.auth.signOut();
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
  };

  const onDelete = async () => {
    await hx.no();
    setDeleteOpen(true);
  };

  const onConfirmDelete = async () => {
    setDeleteOpen(false);
    // TODO: call supabase Edge Function `delete-account` that runs
    // admin.deleteUser() server-side. Until that ships, sign the user out
    // and surface a "we'll process within 24 hours" notice.
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
      await supabase.auth.signOut();
      Alert.alert(
        t('settings.account.delete_title'),
        '24 saat içinde verilerin sistemden silinecek. seninle çalışmak güzeldi 👋',
        [{ text: 'Tamam' }]
      );
      router.replace('/(onboarding)/welcome');
    }
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
          borderBottomColor: palette.ink + '14',
          backgroundColor: palette.paper,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={14}
          accessibilityLabel={t('common.back')}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 12 })}
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
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
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
          paddingBottom: insets.bottom + 140,
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
        </RiseIn>
      </ScrollView>

      {/* Pinned footer */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + 16,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
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
            color: palette.ink,
            fontSize: 11,
            opacity: 0.7,
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
                fontFamily: 'Inter_700Bold',
                color: palette.ink,
                fontSize: 12,
                opacity: 0.85,
              }}
            >
              {t('settings.about.privacy')}
            </Text>
          </Pressable>
          <Text
            style={{
              fontFamily: 'Inter_700Bold',
              color: palette.ink,
              fontSize: 12,
              marginHorizontal: 8,
              opacity: 0.4,
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
                fontFamily: 'Inter_700Bold',
                color: palette.ink,
                fontSize: 12,
                opacity: 0.85,
              }}
            >
              {t('settings.about.terms')}
            </Text>
          </Pressable>
        </View>
      </View>

      <EditModal
        visible={editField === 'name'}
        title={t('settings.profile.edit_name')}
        initial={displayName}
        onSave={saveName}
        onClose={() => setEditField(null)}
      />
      <EditModal
        visible={editField === 'username'}
        title={t('settings.profile.edit_username')}
        initial={username}
        placeholder="mert_42"
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
        onCancel={() => setDeleteOpen(false)}
        onConfirm={onConfirmDelete}
      />
    </View>
  );
}

/**
 * Hard-confirmation sheet for account deletion. User has to type "SİL" to
 * unlock the destructive button — Apple wants destructive flows that aren't
 * trivially fat-fingerable.
 */
function DeleteAccountModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState('');
  useEffect(() => {
    if (!visible) setConfirmText('');
  }, [visible]);

  const matches = confirmText.trim().toLocaleUpperCase('tr-TR') === 'SİL';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: '#00000080',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: palette.paper,
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
              backgroundColor: palette.ink + '22',
              marginBottom: 18,
            }}
          />

          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: palette.coral,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Feather name="alert-triangle" size={28} color={palette.paper} />
          </View>

          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 26,
              lineHeight: 30,
            }}
          >
            hesabını silmek istediğine emin misin?
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 14,
              lineHeight: 20,
              marginTop: 10,
              opacity: 0.85,
            }}
          >
            tüm seans geçmişin, kart bilgilerin, sıralaman silinir. bu işlem geri alınamaz.
          </Text>

          {/* Bullet list */}
          <View
            style={{
              marginTop: 18,
              backgroundColor: palette.coral + '14',
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: palette.coral + '55',
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
                  color={palette.coral}
                  style={{ marginRight: 10 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: 'Inter_700Bold',
                    color: palette.ink,
                    fontSize: 13,
                  }}
                >
                  {line}
                </Text>
              </View>
            ))}
          </View>

          {/* Type-to-confirm */}
          <Text
            style={{
              fontFamily: 'Unbounded_700Bold',
              color: palette.ink,
              fontSize: 12,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              marginTop: 18,
              marginBottom: 8,
            }}
          >
            onaylamak için "SİL" yaz
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="SİL"
            placeholderTextColor={palette.ink + '55'}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{
              borderWidth: 2,
              borderColor: matches ? palette.coral : palette.ink + '22',
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 14,
              fontFamily: 'Unbounded_800ExtraBold',
              fontSize: 18,
              color: palette.ink,
              letterSpacing: 1.2,
              backgroundColor: palette.paper,
            }}
          />

          {/* Destructive CTA */}
          <Pressable
            onPress={matches ? onConfirm : undefined}
            disabled={!matches}
            accessibilityRole="button"
            accessibilityLabel="hesabımı sil"
            style={({ pressed }) => ({
              marginTop: 22,
              opacity: !matches ? 0.45 : pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                backgroundColor: matches ? palette.coral : palette.ink + '33',
                borderRadius: 18,
                paddingVertical: 18,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                shadowColor: palette.coral,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: matches ? 0.28 : 0,
                shadowRadius: 16,
                elevation: matches ? 10 : 0,
              }}
            >
              <Feather name="trash-2" size={20} color={palette.paper} style={{ marginRight: 10 }} />
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  color: palette.paper,
                  fontSize: 16,
                  letterSpacing: 0.4,
                }}
              >
                hesabımı sil
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
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.ink + '0d',
                borderWidth: 1.5,
                borderColor: palette.ink + '22',
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_700Bold',
                  color: palette.ink,
                  fontSize: 14,
                }}
              >
                vazgeç
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
