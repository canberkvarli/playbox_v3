/**
 * Local notification scheduling for an active session. We promise the user
 * on the agreement slide that "telefonun titrer before time's up" — this
 * delivers on that promise without waiting for the server-side push
 * infrastructure to ship.
 *
 * Two notifications per session:
 *   1. Pre-warning 2 minutes before the planned duration ends (custom chime)
 *   2. End notice exactly at the planned duration (custom chime)
 *
 * Both carry a CUSTOM sound (assets/sounds/{twomin,done}.wav, bundled via the
 * expo-notifications config plugin) and — on Android — a distinctive vibration
 * pattern via per-alert channels. iOS can't set a custom vibration pattern for
 * a normal notification (only the system buzz tied to the sound), so on iOS the
 * chime is the distinctive part. A foreground handler makes the alert sound
 * even when the app is open.
 *
 * Both are scheduled at session start, cancelled at session end. expo-
 * notifications is loaded lazily so a missing/unbuilt native module
 * doesn't crash the bundle in dev.
 */
import { Platform } from 'react-native';

let Notifications: any = null;
function load() {
  if (Notifications !== null) return Notifications;
  try {
    Notifications = require('expo-notifications');
    return Notifications;
  } catch {
    Notifications = false;
    return null;
  }
}

const TAG_PRE = 'playbox:session-pre';
const TAG_END = 'playbox:session-end';
const CH_PRE = 'playbox-2min';
const CH_END = 'playbox-end';

const PRE_WARN_MIN = 2;

let configured = false;
/**
 * Idempotently install the foreground handler (so alerts sound while the app
 * is open) and the Android channels that carry the custom sound + distinctive
 * vibration patterns. Safe to call repeatedly.
 */
async function ensureChannelsAndHandler() {
  const N = load();
  if (!N) return;
  if (configured) return;
  configured = true;
  try {
    N.setNotificationHandler?.({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    /* handler best-effort */
  }
  if (Platform.OS === 'android' && N.setNotificationChannelAsync) {
    try {
      await N.setNotificationChannelAsync(CH_PRE, {
        name: '2 dakika uyarısı',
        importance: N.AndroidImportance?.HIGH ?? 4,
        sound: 'twomin', // res/raw name (no extension), bundled by the plugin
        vibrationPattern: [0, 200, 120, 320],
        enableVibrate: true,
      });
      await N.setNotificationChannelAsync(CH_END, {
        name: 'Seans bitti',
        importance: N.AndroidImportance?.HIGH ?? 4,
        sound: 'done',
        vibrationPattern: [0, 320, 160, 320],
        enableVibrate: true,
      });
    } catch {
      /* channels best-effort — fall back to the default channel */
    }
  }
}

async function ensurePermissions(): Promise<boolean> {
  const N = load();
  if (!N?.getPermissionsAsync) return false;
  try {
    const cur = await N.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain === false) return false;
    const next = await N.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return !!next.granted;
  } catch {
    return false;
  }
}

export async function scheduleSessionEndAlerts({
  stationName,
  durationMinutes,
  startedAt,
}: {
  stationName: string;
  durationMinutes: number;
  startedAt: number;
}) {
  const N = load();
  if (!N?.scheduleNotificationAsync) return;
  const ok = await ensurePermissions();
  if (!ok) return;
  await ensureChannelsAndHandler();

  // Compute the two trigger times. If startedAt was in the past (resuming a
  // session after app reload), only schedule the alerts that are still in the
  // future.
  const now = Date.now();
  const endAt = startedAt + durationMinutes * 60_000;
  const preAt = endAt - PRE_WARN_MIN * 60_000;

  // Wipe any prior notifications first — fresh session = fresh schedule.
  await cancelSessionEndAlerts();

  // expo-notifications SDK 53+ requires `type: 'date'` on date-based
  // triggers. The earlier `{ date }` shorthand throws a TypeError now.
  if (preAt > now) {
    try {
      await N.scheduleNotificationAsync({
        identifier: TAG_PRE,
        content: {
          title: '2 dk kaldı',
          body: `${stationName} • ekipmanı toparlamaya başla.`,
          sound: 'twomin.wav', // iOS: bundled custom chime (Android uses the channel)
          data: { kind: 'session-pre' },
        },
        trigger: { type: 'date', date: new Date(preAt), channelId: CH_PRE },
      });
    } catch (e) {
      if (__DEV__) console.warn('[sessionNotif] pre schedule failed', e);
    }
  }

  if (endAt > now) {
    try {
      await N.scheduleNotificationAsync({
        identifier: TAG_END,
        content: {
          title: 'süre doldu',
          body: `${stationName} • ekipmanı iade et, kapıyı kapat.`,
          sound: 'done.wav',
          data: { kind: 'session-end' },
        },
        trigger: { type: 'date', date: new Date(endAt), channelId: CH_END },
      });
    } catch (e) {
      if (__DEV__) console.warn('[sessionNotif] end schedule failed', e);
    }
  }
}

/**
 * Present an immediate "session done" chime + banner — used when the user
 * finishes manually (the scheduled end alert is cancelled at that point, so
 * this is what actually makes the finish sound). Best-effort.
 */
export async function fireDoneAlertNow(stationName: string) {
  const N = load();
  if (!N?.scheduleNotificationAsync) return;
  const ok = await ensurePermissions();
  if (!ok) return;
  await ensureChannelsAndHandler();
  try {
    await N.scheduleNotificationAsync({
      content: {
        title: 'seans tamamlandı',
        body: stationName ? `${stationName} • teşekkürler!` : 'teşekkürler!',
        sound: 'done.wav', // iOS custom chime; Android uses the channel below
        data: { kind: 'session-done' },
      },
      // Immediate. On Android the channel carries the custom sound + vibration;
      // on iOS the foreground handler + content.sound play the chime.
      trigger:
        Platform.OS === 'android'
          ? ({ type: 'date', date: new Date(Date.now() + 50), channelId: CH_END } as any)
          : null,
    });
  } catch (e) {
    if (__DEV__) console.warn('[sessionNotif] done-now failed', e);
  }
}

export async function cancelSessionEndAlerts() {
  const N = load();
  if (!N?.cancelScheduledNotificationAsync) return;
  for (const id of [TAG_PRE, TAG_END]) {
    try {
      await N.cancelScheduledNotificationAsync(id);
    } catch {
      // Either already-cancelled or never-existed; both are fine.
    }
  }
}
