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
import { useTheme } from '@/hooks/useTheme';
import { useDisplayUser } from '@/hooks/useDisplayUser';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
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
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
      className="bg-paper dark:bg-ink border border-ink/10 dark:border-paper/10 rounded-2xl px-4 py-4 flex-row items-center gap-3"
    >
      <Text
        className={
          destructive
            ? 'flex-1 font-medium text-coral text-base'
            : 'flex-1 font-medium text-ink dark:text-paper text-base'
        }
      >
        {label}
      </Text>
      {value !== undefined ? (
        <Text className="font-sans text-ink/55 dark:text-paper/55 text-sm">
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Feather name="chevron-right" size={16} color={theme.fg + '55'} />
      ) : null}
    </Pressable>
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
  const theme = useTheme();
  const { t } = useT();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  // Initial (displayName / username) hydrates asynchronously from Supabase —
  // if the modal opens before auth has loaded, the input would briefly show
  // the fallback ("Oyuncu"). Sync `value` whenever the modal becomes visible
  // OR the initial prop changes so the user only ever sees the real value.
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
            backgroundColor: theme.bg,
            borderRadius: 20,
            padding: 20,
          }}
        >
          <Text className="font-display text-ink dark:text-paper text-lg">
            {title}
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.fg + '66'}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={{
              marginTop: 14,
              borderWidth: 1,
              borderColor: theme.fg + '22',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: theme.fg,
              fontSize: 16,
            }}
          />
          <View className="flex-row gap-2 mt-4">
            <Pressable
              onPress={onClose}
              className="flex-1 border border-ink/15 dark:border-paper/15 rounded-xl py-3"
            >
              <Text className="font-medium text-ink dark:text-paper text-center">
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={saving}
              style={{
                flex: 1,
                backgroundColor: palette.coral,
                borderRadius: 12,
                paddingVertical: 12,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text className="font-semibold text-paper text-center">
                {t('common.done')}
              </Text>
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
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthSession();
  const { displayName, username, phone } = useDisplayUser();

  const [editField, setEditField] = useState<'name' | 'username' | null>(null);
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

  // Phone changes require identity re-verification, so we don't let users
  // edit it inline. Redirect to support for now — post-MVP this becomes an
  // OTP-gated re-verification flow.
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
    Alert.alert(t('settings.account.delete_title'), t('settings.account.delete_msg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.account.delete_cta'),
        style: 'destructive',
        onPress: async () => {
          // Supabase doesn't expose a client-side account delete; this needs a
          // server-side Edge Function calling admin.deleteUser(). For now, sign
          // the user out and surface a support note — wire the Edge Function
          // before launch.
          await supabase.auth.signOut();
          Alert.alert(
            t('settings.account.delete_title'),
            t('settings.about.coming_soon')
          );
          router.replace('/(onboarding)/welcome');
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
      {/* Sticky header — identical to profile.tsx */}
      <View
        style={{ paddingTop: insets.top + 8 }}
        className="px-6 pb-3 border-b border-ink/10 dark:border-paper/10 bg-paper dark:bg-ink flex-row items-center gap-2"
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={14}
          accessibilityLabel={t('common.back')}
          style={{ marginLeft: -6, padding: 4 }}
        >
          <Feather name="chevron-left" size={24} color={theme.fg} />
        </Pressable>
        <Text className="font-display text-ink dark:text-paper text-lg">
          {t('settings.title')}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 120, // leave room for pinned footer
        }}
      >
        {/* Profil section */}
        <RiseIn delay={0}>
          <View className="mt-6">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('settings.profile.section')}
            </Text>
            <View className="gap-3">
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
            </View>
          </View>
        </RiseIn>

        {/* Hesap section */}
        <RiseIn delay={80}>
          <View className="mt-6">
            <Text className="font-medium text-ink/60 dark:text-paper/60 uppercase tracking-wider text-xs mb-3">
              {t('settings.account.section')}
            </Text>
            <View className="gap-3">
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
            </View>
          </View>
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
        <Text className="font-display text-butter text-xs tracking-[4px] mb-2">
          PLAYBOX
        </Text>
        <Text className="font-mono text-ink/40 dark:text-paper/40 text-xs">
          {t('settings.about.version')} {version}
        </Text>
        <View className="flex-row items-center gap-2 mt-2">
          <Pressable
            onPress={async () => {
              await hx.tap();
              Alert.alert(t('settings.about.privacy'), t('settings.about.coming_soon'));
            }}
            hitSlop={8}
          >
            <Text className="font-sans text-ink/50 dark:text-paper/50 text-xs">
              {t('settings.about.privacy')}
            </Text>
          </Pressable>
          <Text className="font-sans text-ink/25 dark:text-paper/25 text-xs">·</Text>
          <Pressable
            onPress={async () => {
              await hx.tap();
              Alert.alert(t('settings.about.terms'), t('settings.about.coming_soon'));
            }}
            hitSlop={8}
          >
            <Text className="font-sans text-ink/50 dark:text-paper/50 text-xs">
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
    </View>
  );
}
