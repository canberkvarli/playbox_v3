import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';

type PermStatus = 'idle' | 'granted' | 'denied';
type PermKey = 'location' | 'notif' | 'camera';
type PermsState = Record<PermKey, PermStatus>;

const ICONS: Record<PermKey, keyof typeof Feather.glyphMap> = {
  location: 'map-pin',
  notif: 'bell',
  camera: 'camera',
};

async function readInitial(): Promise<PermsState> {
  const [loc, notif, cam] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
    Camera.getCameraPermissionsAsync(),
  ]);
  return {
    location: loc.granted ? 'granted' : loc.canAskAgain === false ? 'denied' : 'idle',
    notif:    notif.granted ? 'granted' : notif.canAskAgain === false ? 'denied' : 'idle',
    camera:   cam.granted ? 'granted' : cam.canAskAgain === false ? 'denied' : 'idle',
  };
}

async function request(key: PermKey): Promise<PermStatus> {
  const result =
    key === 'location' ? await Location.requestForegroundPermissionsAsync() :
    key === 'notif'    ? await Notifications.requestPermissionsAsync() :
                         await Camera.requestCameraPermissionsAsync();
  return result.granted ? 'granted' : 'denied';
}

function PermissionCard({
  k,
  status,
  onPress,
  t,
}: {
  k: PermKey;
  status: PermStatus;
  onPress: () => void;
  t: (key: string) => string;
}) {
  const granted = status === 'granted';
  const denied  = status === 'denied';

  const cardCls =
    granted ? 'bg-butter border-ink/10' :
    denied  ? 'bg-paper border-coral/30' :
              'bg-paper border-ink/15';

  const iconBg =
    granted ? palette.ink + '1a' :
    denied  ? palette.coral + '26' :
              palette.mauve + '26';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`onb.perms.${k}.title`)}
      onPress={onPress}
      className={`${cardCls} border rounded-2xl px-4 py-4 flex-row items-center gap-4`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.99 : 1 }] })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          backgroundColor: iconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={ICONS[k]} size={24} color={palette.ink} />
      </View>
      <View className="flex-1">
        <Text className="font-medium text-ink text-base">{t(`onb.perms.${k}.title`)}</Text>
        <Text className="font-sans text-ink/60 text-sm mt-0.5">{t(`onb.perms.${k}.why`)}</Text>
        {denied && (
          <Text className="text-coral/80 text-xs mt-1 font-sans">{t('onb.perms.denied')}</Text>
        )}
      </View>
      {granted ? (
        <Feather name="check" size={22} color={palette.ink} />
      ) : denied ? (
        <Text className="text-coral text-sm font-medium">{t('onb.perms.retry')}</Text>
      ) : (
        <Feather name="chevron-right" size={20} color={palette.ink + '66'} />
      )}
    </Pressable>
  );
}

export default function Permissions() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [perms, setPerms] = useState<PermsState>({
    location: 'idle',
    notif: 'idle',
    camera: 'idle',
  });

  useEffect(() => {
    readInitial().then(setPerms).catch(() => {});
  }, []);

  const handle = (key: PermKey) => async () => {
    await hx.tap();
    const next = await request(key);
    setPerms((p) => ({ ...p, [key]: next }));
    if (next === 'granted') await hx.yes();
  };

  const ctaEnabled = perms.location === 'granted';

  const onContinue = async () => {
    if (!ctaEnabled) return;
    await hx.press();
    router.push('/(onboarding)/phone');
  };
  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  return (
    <View
      className="flex-1 bg-paper px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={palette.ink} />
        </Pressable>
        <OnboardingProgress total={4} active={3} />
      </View>

      <View className="mt-12">
        <Text
          className="font-display-x text-ink text-5xl"
          style={{ lineHeight: 48 }}
        >
          {t('onb.perms.title')}
        </Text>
      </View>

      <View className="mt-8 gap-3">
        <PermissionCard k="location" status={perms.location} onPress={handle('location')} t={t} />
        <PermissionCard k="notif"    status={perms.notif}    onPress={handle('notif')}    t={t} />
        <PermissionCard k="camera"   status={perms.camera}   onPress={handle('camera')}   t={t} />
      </View>

      <View className="flex-1" />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onb.perms.cta')}
        accessibilityState={{ disabled: !ctaEnabled }}
        onPress={onContinue}
        disabled={!ctaEnabled}
        className={`${ctaEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20'} rounded-2xl py-5`}
        style={({ pressed }) => ({
          transform: [{ scale: pressed && ctaEnabled ? 0.98 : 1 }],
        })}
      >
        <Text
          className={`${ctaEnabled ? 'text-paper' : 'text-ink/50'} font-semibold text-lg text-center`}
        >
          {t('onb.perms.cta')}
        </Text>
      </Pressable>
    </View>
  );
}
