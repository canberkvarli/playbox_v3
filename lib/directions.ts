import { Alert, Linking, Platform } from 'react-native';

export type Destination = { name: string; lat: number; lng: number };

function open(url: string) {
  Linking.openURL(url).catch(() => {});
}

/**
 * Show a maps-app chooser and open the picked app's directions to `dest`.
 *
 * Uses https universal links so each opens the NATIVE app if installed, else the
 * web — no URL-scheme whitelist (Info.plist LSApplicationQueriesSchemes) needed,
 * so this stays fully OTA-safe. Apple Maps is offered on iOS only. Yandex is
 * included because it is widely used in Türkiye.
 */
export function openDirections(dest: Destination) {
  const { name, lat, lng } = dest;
  const q = encodeURIComponent(name);
  const apple = `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const yandex = `https://yandex.com/maps/?rtext=~${lat},${lng}&rtt=auto`;

  const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [];
  if (Platform.OS === 'ios') {
    buttons.push({ text: 'apple haritalar', onPress: () => open(apple) });
  }
  buttons.push({ text: 'google haritalar', onPress: () => open(google) });
  buttons.push({ text: 'yandex', onPress: () => open(yandex) });
  buttons.push({ text: 'iptal', style: 'cancel' });

  Alert.alert('yol tarifi', name, buttons, { cancelable: true });
}
