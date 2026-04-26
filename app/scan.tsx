import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
let CameraView: any = null;
let useCameraPermissions: any = () => [null, () => {}];
try {
  const mod = require('expo-camera');
  CameraView = mod.CameraView;
  useCameraPermissions = mod.useCameraPermissions;
} catch {}
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { STATIONS } from '@/data/stations.seed';
import { useMapStore } from '@/stores/mapStore';
import { useSessionStore } from '@/stores/sessionStore';

export default function Scan() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const cacheStation = useMapStore((s) => s.cacheStation);
  const setPendingSheetStationId = useMapStore((s) => s.setPendingSheetStationId);

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain) requestPermission();
  }, [permission]);

  // Bail out early if a session is already active — no point letting the user
  // line up a QR they can't use. Redirect to /play so they end the existing
  // session first (or continue it).
  useEffect(() => {
    const active = useSessionStore.getState().active;
    if (!active) return;
    Alert.alert(
      t('common.error_generic'),
      t('station.blocked_session_here'),
      [{ text: 'Tamam', onPress: () => router.replace('/(tabs)/play') }]
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResult = (id: string) => {
    // Race guard: a session might have started on another surface between the
    // mount check and a successful scan. Hard-stop rather than double-book.
    if (useSessionStore.getState().active) {
      Alert.alert(
        t('common.error_generic'),
        t('station.blocked_session_here'),
        [{ text: 'Tamam', onPress: () => router.replace('/(tabs)/play') }]
      );
      return;
    }
    const station = STATIONS.find((s) => s.id === id);
    if (!station) {
      Alert.alert(t('scan.not_found'));
      setScanned(false);
      return;
    }
    cacheStation(station);
    setPendingSheetStationId(station.id);
    router.replace('/(tabs)/map');
  };

  const onBarcode = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    hx.yes();
    const match = data.match(/station\/([^/?]+)/);
    onResult(match?.[1] ?? data.trim());
  };

  const onDevPick = async () => {
    await hx.tap();
    const random = STATIONS[Math.floor(Math.random() * STATIONS.length)];
    onResult(random.id);
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  if (!permission) return <View className="flex-1 bg-ink" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-ink items-center justify-center px-6">
        <Text className="font-display-x text-paper text-3xl text-center">
          {t('scan.permission_needed')}
        </Text>
        <Pressable
          onPress={requestPermission}
          className="bg-coral rounded-2xl py-4 px-6 mt-8"
        >
          <Text className="text-paper font-semibold text-base">{t('scan.grant')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink">
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        onBarcodeScanned={scanned ? undefined : onBarcode}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top + 12, left: 16 }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: palette.paper + 'cc',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="x" size={20} color={palette.ink} />
        </Pressable>
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: '30%',
          left: '15%',
          right: '15%',
          aspectRatio: 1,
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
          const pos: any = { position: 'absolute' };
          if (corner.includes('t')) pos.top = 0;
          else pos.bottom = 0;
          if (corner.includes('l')) pos.left = 0;
          else pos.right = 0;
          const border: any = { width: 32, height: 32, borderColor: palette.coral };
          if (corner.includes('t')) border.borderTopWidth = 3;
          else border.borderBottomWidth = 3;
          if (corner.includes('l')) {
            border.borderLeftWidth = 3;
            border[
              `border${corner.includes('t') ? 'TopLeft' : 'BottomLeft'}Radius`
            ] = 8;
          } else {
            border.borderRightWidth = 3;
            border[
              `border${corner.includes('t') ? 'TopRight' : 'BottomRight'}Radius`
            ] = 8;
          }
          return <View key={corner} style={[pos, border]} />;
        })}
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + 140,
          left: 24,
          right: 24,
          alignItems: 'center',
        }}
      >
        <Text
          className="font-display-x text-paper text-3xl text-center"
          style={{ lineHeight: 32 }}
        >
          {t('scan.title')}
        </Text>
        <Text className="font-sans text-paper/80 text-base text-center mt-2">
          {t('scan.sub')}
        </Text>
      </View>
      {__DEV__ ? (
        <Pressable
          onPress={onDevPick}
          style={{
            position: 'absolute',
            bottom: insets.bottom + 40,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
          hitSlop={12}
        >
          <View
            style={{
              backgroundColor: palette.paper + 'cc',
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
            }}
          >
            <Text className="font-mono text-ink text-xs underline">
              dev: rastgele istasyon seç
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
