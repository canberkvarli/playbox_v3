import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';

// expo-camera 17 (SDK 53+) replaced the Camera class methods with top-level
// named exports. Prefer those; fall back to legacy class methods for older SDKs.
let CameraPerms: {
  get?: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  request?: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
} = {};
try {
  const mod = require('expo-camera');
  CameraPerms.get =
    mod.getCameraPermissionsAsync ??
    mod.Camera?.getCameraPermissionsAsync;
  CameraPerms.request =
    mod.requestCameraPermissionsAsync ??
    mod.Camera?.requestCameraPermissionsAsync;
} catch {}

let Notifications: any = null;
try { Notifications = require('expo-notifications'); } catch {}

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';

type PermStatus = 'idle' | 'granted' | 'denied';
type PermKey = 'location' | 'notif' | 'camera';
type PermsState = Record<PermKey, PermStatus>;

const ICONS: Record<PermKey, keyof typeof Feather.glyphMap> = {
  location: 'map-pin',
  notif: 'bell',
  camera: 'camera',
};

const REQUIRED: Record<PermKey, boolean> = {
  location: true,   // nearby stations, in-range unlock, reservation lock
  notif: false,     // reservation / session reminders — nice to have
  camera: false,    // QR scan shortcut; map-tap flow works without it
};

async function readInitial(): Promise<PermsState> {
  const loc = await Location.getForegroundPermissionsAsync();

  let cam = { granted: false, canAskAgain: true } as any;
  if (CameraPerms.get) {
    try { cam = await CameraPerms.get(); } catch (e) { console.warn('cam get', e); }
  }

  let notif = { granted: false, canAskAgain: true } as any;
  if (Notifications?.getPermissionsAsync) {
    try { notif = await Notifications.getPermissionsAsync(); } catch (e) { console.warn('notif get', e); }
  }

  return {
    location: loc.granted ? 'granted' : loc.canAskAgain === false ? 'denied' : 'idle',
    notif:    notif.granted ? 'granted' : notif.canAskAgain === false ? 'denied' : 'idle',
    camera:   cam.granted ? 'granted' : cam.canAskAgain === false ? 'denied' : 'idle',
  };
}

async function request(key: PermKey): Promise<PermStatus> {
  if (key === 'location') {
    const r = await Location.requestForegroundPermissionsAsync();
    return r.granted ? 'granted' : 'denied';
  }
  if (key === 'notif') {
    if (!Notifications?.requestPermissionsAsync) {
      console.warn('expo-notifications not linked');
      return 'denied';
    }
    try {
      const r = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      return r.granted || r.status === 'granted' ? 'granted' : 'denied';
    } catch (e) {
      console.warn('notif request failed', e);
      return 'denied';
    }
  }
  if (!CameraPerms.request) {
    console.warn('expo-camera request API missing');
    return 'denied';
  }
  try {
    const r = await CameraPerms.request();
    return r.granted ? 'granted' : 'denied';
  } catch (e) {
    console.warn('cam request failed', e);
    return 'denied';
  }
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
  const theme = useTheme();
  const granted = status === 'granted';
  const denied  = status === 'denied';

  const cardCls =
    granted ? 'bg-butter border-ink/10' :
    denied  ? 'bg-paper dark:bg-ink border-coral/30' :
              'bg-paper dark:bg-ink border-ink/15 dark:border-paper/15';

  const iconBg =
    granted ? palette.ink + '1a' :
    denied  ? palette.coral + '26' :
              palette.mauve + '26';

  // On butter (granted) the ink icon stays ink. Otherwise invert with theme.
  const iconColor = granted ? palette.ink : theme.fg;

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
        <Feather name={ICONS[k]} size={24} color={granted ? palette.ink : theme.fg} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className={`font-medium text-base ${granted ? 'text-ink' : 'text-ink dark:text-paper'}`}>{t(`onb.perms.${k}.title`)}</Text>
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: REQUIRED[k] ? palette.coral + '26' : theme.fg + '14',
            }}
          >
            <Text
              className="font-mono"
              style={{
                fontSize: 9,
                color: REQUIRED[k] ? palette.coral : theme.fg + '99',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                fontWeight: '700',
              }}
            >
              {t(REQUIRED[k] ? 'onb.perms.required' : 'onb.perms.optional')}
            </Text>
          </View>
        </View>
        <Text className={`font-sans text-sm mt-0.5 ${granted ? 'text-ink/60' : 'text-ink/60 dark:text-paper/60'}`}>{t(`onb.perms.${k}.why`)}</Text>
        {denied && (
          <Text className="text-coral/80 text-xs mt-1 font-sans">
            {REQUIRED[k] ? t('onb.perms.denied_required') : t('onb.perms.denied_optional')}
          </Text>
        )}
      </View>
      {granted ? (
        <Feather name="check" size={22} color={palette.ink} />
      ) : denied ? (
        <Text className="text-coral text-sm font-medium">{t('onb.perms.retry')}</Text>
      ) : (
        <Feather name="chevron-right" size={20} color={theme.fg + '66'} />
      )}
    </Pressable>
  );
}

export default function Permissions() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

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
      className="flex-1 bg-paper dark:bg-ink px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={24} color={theme.fg} />
        </Pressable>
        <OnboardingProgress total={4} active={3} />
      </View>

      <RiseIn delay={0}>
        <View className="mt-12">
          <Text
            className="font-display-x text-ink dark:text-paper text-5xl"
            style={{ lineHeight: 48 }}
          >
            {t('onb.perms.title')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View className="mt-8 gap-3">
          <PermissionCard k="location" status={perms.location} onPress={handle('location')} t={t} />
          <PermissionCard k="notif"    status={perms.notif}    onPress={handle('notif')}    t={t} />
          <PermissionCard k="camera"   status={perms.camera}   onPress={handle('camera')}   t={t} />
        </View>
      </RiseIn>

      <View className="flex-1" />

      <RiseIn delay={220}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onb.perms.cta')}
          accessibilityState={{ disabled: !ctaEnabled }}
          onPress={onContinue}
          disabled={!ctaEnabled}
          className={`${ctaEnabled ? 'bg-coral active:opacity-90' : 'bg-ink/20 dark:bg-paper/20'} rounded-2xl py-5`}
          style={({ pressed }) => ({
            transform: [{ scale: pressed && ctaEnabled ? 0.98 : 1 }],
          })}
        >
          <Text
            className={`${ctaEnabled ? 'text-paper' : 'text-ink/50 dark:text-paper/50'} font-semibold text-lg text-center`}
          >
            {t('onb.perms.cta')}
          </Text>
        </Pressable>
        <Text className="font-sans text-ink/50 dark:text-paper/50 text-xs text-center mt-3">
          {t('onb.perms.optional_hint')}
        </Text>
      </RiseIn>
    </View>
  );
}
