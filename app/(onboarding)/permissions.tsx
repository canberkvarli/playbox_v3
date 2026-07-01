import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { stationClient } from '@/lib/ble/stationClient';

let CameraPerms: {
  get?: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  request?: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
} = {};
try {
  const mod = require('expo-camera');
  CameraPerms.get = mod.getCameraPermissionsAsync ?? mod.Camera?.getCameraPermissionsAsync;
  CameraPerms.request = mod.requestCameraPermissionsAsync ?? mod.Camera?.requestCameraPermissionsAsync;
} catch {}

let Notifications: any = null;
try { Notifications = require('expo-notifications'); } catch {}

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { OnboardingProgress } from '@/components/OnboardingProgress';
import { RiseIn } from '@/components/RiseIn';
import { Button } from '@/components/ui';
import { useGuardedPress } from '@/hooks/useGuardedPress';

type PermStatus = 'idle' | 'granted' | 'denied';
type PermKey = 'location' | 'notif' | 'camera' | 'bt';
type PermsState = Record<PermKey, PermStatus>;

const ICONS: Record<PermKey, keyof typeof Feather.glyphMap> = {
  location: 'map-pin',
  notif: 'bell',
  camera: 'camera',
  bt: 'bluetooth',
};

const REQUIRED: Record<PermKey, boolean> = {
  location: true,
  notif: false,
  camera: false,
  bt: true,
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
    // BT initial status starts at 'idle'. We deliberately don't probe iOS state
    // on mount — instantiating the BleManager would surface the system prompt
    // without context. The user has to tap the card first.
    bt:       'idle',
  };
}

async function request(key: PermKey): Promise<PermStatus> {
  if (key === 'location') {
    const r = await Location.requestForegroundPermissionsAsync();
    return r.granted ? 'granted' : 'denied';
  }
  if (key === 'notif') {
    if (!Notifications?.requestPermissionsAsync) return 'denied';
    try {
      const r = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      return r.granted || r.status === 'granted' ? 'granted' : 'denied';
    } catch { return 'denied'; }
  }
  if (key === 'bt') {
    try {
      return await stationClient.requestPermission();
    } catch { return 'denied'; }
  }
  if (!CameraPerms.request) return 'denied';
  try {
    const r = await CameraPerms.request();
    return r.granted ? 'granted' : 'denied';
  } catch { return 'denied'; }
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
  const denied = status === 'denied';

  const cardBg = granted ? palette.volt + '14' : palette.surface;
  const cardBorder = granted ? palette.volt : denied ? palette.danger + '55' : palette.border;
  const iconBg = granted ? palette.volt : denied ? palette.danger + '22' : palette.surfaceAlt;
  const iconColor = granted ? palette.voltInk : denied ? palette.danger : palette.fg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`onb.perms.${k}.title`)}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, marginBottom: 12 })}
    >
      <View
        style={{
          backgroundColor: cardBg,
          borderRadius: 16,
          paddingHorizontal: 14,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1.5,
          borderColor: cardBorder,
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: iconBg,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Feather name={ICONS[k]} size={22} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
                fontSize: 15,
                marginRight: 8,
              }}
            >
              {t(`onb.perms.${k}.title`)}
            </Text>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: REQUIRED[k] ? palette.volt + '26' : palette.surfaceAlt,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  fontSize: 9,
                  color: REQUIRED[k] ? palette.volt : palette.muted,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                }}
              >
                {t(REQUIRED[k] ? 'onb.perms.required' : 'onb.perms.optional')}
              </Text>
            </View>
          </View>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.muted,
              fontSize: 13,
              lineHeight: 18,
              marginTop: 4,
            }}
          >
            {t(`onb.perms.${k}.why`)}
          </Text>
          {denied && (
            <Text
              style={{
                color: palette.danger,
                fontSize: 12,
                marginTop: 4,
                fontFamily: 'Unbounded_700Bold',
              }}
            >
              {REQUIRED[k] ? t('onb.perms.denied_required') : t('onb.perms.denied_optional')}
            </Text>
          )}
        </View>
        {granted ? (
          <Feather name="check" size={22} color={palette.volt} />
        ) : denied ? (
          <Text style={{ color: palette.danger, fontFamily: 'Unbounded_700Bold', fontSize: 13 }}>
            {/* iOS only allows the system Bluetooth prompt once. After deny,
                recovery is via Settings — the card press handler routes there. */}
            {k === 'bt' ? t('onb.perms.open_settings') : t('onb.perms.retry')}
          </Text>
        ) : (
          <Feather name="chevron-right" size={20} color={palette.muted} />
        )}
      </View>
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
    bt: 'idle',
  });

  useEffect(() => {
    readInitial().then(setPerms).catch(() => {});
  }, []);

  const handle = (key: PermKey) => async () => {
    await hx.tap();
    // iOS Bluetooth only prompts once. If we previously got 'denied', the
    // OS won't re-prompt — the only path forward is Settings.
    if (key === 'bt' && perms.bt === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    const next = await request(key);
    setPerms((p) => ({ ...p, [key]: next }));
    if (next === 'granted') await hx.yes();
  };

  const ctaEnabled = perms.location === 'granted' && perms.bt === 'granted';

  const onContinue = useGuardedPress(async () => {
    if (!ctaEnabled) return;
    await hx.press();
    router.push('/(onboarding)/phone');
  });
  const onBack = useGuardedPress(async () => {
    await hx.tap();
    router.back();
  });

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.bg,
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.fg} />
          </View>
        </Pressable>
        <OnboardingProgress total={4} active={3} />
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 40 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 44,
              lineHeight: 52,
            }}
          >
            {t('onb.perms.title')}
          </Text>
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <View style={{ marginTop: 28 }}>
          <PermissionCard k="location" status={perms.location} onPress={handle('location')} t={t} />
          <PermissionCard k="bt"       status={perms.bt}       onPress={handle('bt')}       t={t} />
          <PermissionCard k="notif"    status={perms.notif}    onPress={handle('notif')}    t={t} />
          <PermissionCard k="camera"   status={perms.camera}   onPress={handle('camera')}   t={t} />
        </View>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Button
          label={t('onb.perms.cta')}
          onPress={onContinue}
          disabled={!ctaEnabled}
          full
        />
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.muted,
            fontSize: 12,
            textAlign: 'center',
            marginTop: 12,
          }}
        >
          {t('onb.perms.optional_hint')}
        </Text>
      </RiseIn>
    </View>
  );
}
