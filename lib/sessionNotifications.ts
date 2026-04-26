/**
 * Local notification scheduling for an active session. We promise the user
 * on the agreement slide that "telefonun titrer before time's up" — this
 * delivers on that promise without waiting for the server-side push
 * infrastructure to ship.
 *
 * Two notifications per session:
 *   1. Pre-warning ~5 minutes before the planned duration ends
 *   2. End notice exactly at the planned duration
 *
 * Both are scheduled at session start, cancelled at session end. expo-
 * notifications is loaded lazily so a missing/unbuilt native module
 * doesn't crash the bundle in dev.
 */

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

const PRE_WARN_MIN = 5;

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

  // Compute the two trigger times. If startedAt was in the past (resuming a
  // session after app reload), only schedule the alerts that are still in the
  // future.
  const now = Date.now();
  const endAt = startedAt + durationMinutes * 60_000;
  const preAt = endAt - PRE_WARN_MIN * 60_000;

  // Wipe any prior notifications first — fresh session = fresh schedule.
  await cancelSessionEndAlerts();

  if (preAt > now) {
    try {
      await N.scheduleNotificationAsync({
        identifier: TAG_PRE,
        content: {
          title: '5 dk kaldı',
          body: `${stationName} • ekipmanı toparlamaya başla.`,
          sound: 'default',
          data: { type: 'session-pre' },
        },
        trigger: { date: new Date(preAt) },
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
          sound: 'default',
          data: { type: 'session-end' },
        },
        trigger: { date: new Date(endAt) },
      });
    } catch (e) {
      if (__DEV__) console.warn('[sessionNotif] end schedule failed', e);
    }
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
