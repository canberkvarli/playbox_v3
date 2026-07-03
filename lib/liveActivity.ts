/**
 * Thin, platform-guarded wrapper around the Playbox Live Activity + home widget.
 *
 * "Active session is everywhere": when a rental session starts we surface it on
 * the Lock Screen / Dynamic Island (Live Activity) and mirror it on the home
 * screen widget; when it ends we tear both down.
 *
 * Everything here is best-effort and iOS-only. On Android, web, or pre-iOS-16.2
 * every function is a no-op — callers can invoke them unconditionally. Failures
 * are swallowed: a Live Activity hiccup must never break the session flow.
 */
import { Platform } from 'react-native';
import type { LiveActivityDismissalPolicy } from 'expo-widgets';

import { SPORT_LABELS } from '@/data/stations.seed';
import type { ActiveSession } from '@/stores/sessionStore';
import type { SessionActivityProps } from '@/widgets/SessionActivity';
import type { PlayboxWidgetProps } from '@/widgets/PlayboxWidget';

// Live Activities require iOS 16.2+. Home-screen widgets require iOS 16+.
// A single gate covers both — below 16.2 we simply skip everything native.
function iosVersionAtLeast(major: number, minor: number): boolean {
  if (Platform.OS !== 'ios') return false;
  const raw = String(Platform.Version); // e.g. "16.2" or "17"
  const [maj, min = '0'] = raw.split('.');
  const majN = Number(maj);
  const minN = Number(min);
  if (Number.isNaN(majN)) return false;
  if (majN !== major) return majN > major;
  return minN >= minor;
}

const SUPPORTED = iosVersionAtLeast(16, 2);

// A single live activity handle for the current session. We keep it here rather
// than in the store so the store stays a pure state container.
type LiveActivityHandle = {
  update: (props: SessionActivityProps) => Promise<void>;
  end: (policy?: LiveActivityDismissalPolicy) => Promise<void>;
};

let currentActivity: LiveActivityHandle | null = null;

// Lazily require the native modules so importing this file on Android/web (or in
// tests) never touches the iOS-only native side.
function loadWidgets():
  | {
      SessionActivity: typeof import('@/widgets/SessionActivity').default;
      PlayboxWidget: typeof import('@/widgets/PlayboxWidget').default;
    }
  | null {
  if (!SUPPORTED) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SessionActivity = require('@/widgets/SessionActivity').default;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PlayboxWidget = require('@/widgets/PlayboxWidget').default;
    return { SessionActivity, PlayboxWidget };
  } catch {
    return null;
  }
}

/** planned end = startedAt + durationMinutes*60000 */
export function plannedEndOf(active: ActiveSession): number {
  return active.startedAt + active.durationMinutes * 60_000;
}

/** True once wall-clock has passed the planned end. */
export function isOverrun(active: ActiveSession, now: number = Date.now()): boolean {
  return now >= plannedEndOf(active);
}

function activityPropsFor(active: ActiveSession): SessionActivityProps {
  return {
    stationName: active.stationName,
    sport: SPORT_LABELS[active.sport],
    gate: active.gate,
    plannedEndAt: plannedEndOf(active),
    overrun: isOverrun(active),
  };
}

function widgetPropsFor(active: ActiveSession | null): PlayboxWidgetProps {
  if (!active) {
    return {
      active: false,
      stationName: '',
      sportLabel: '',
      plannedEndAt: 0,
      overrun: false,
    };
  }
  return {
    active: true,
    stationName: active.stationName,
    sportLabel: SPORT_LABELS[active.sport],
    plannedEndAt: plannedEndOf(active),
    overrun: isOverrun(active),
  };
}

/** Push the home-screen widget snapshot for the given (or idle) session. */
function reloadHomeWidget(active: ActiveSession | null): void {
  const mods = loadWidgets();
  if (!mods) return;
  try {
    mods.PlayboxWidget.updateSnapshot(widgetPropsFor(active));
  } catch {
    // best-effort
  }
}

/**
 * Start (or restart) the Live Activity for a freshly active session, and refresh
 * the home widget. Safe to call unconditionally; no-op off iOS-16.2+.
 */
export function startSessionActivity(active: ActiveSession): void {
  const mods = loadWidgets();
  if (!mods) return;
  try {
    // If one is somehow already running, tear it down first so we don't stack
    // duplicate activities for the same rental.
    if (currentActivity) {
      void currentActivity.end('immediate').catch(() => {});
      currentActivity = null;
    }
    currentActivity = mods.SessionActivity.start(activityPropsFor(active));
  } catch {
    currentActivity = null;
  }
  reloadHomeWidget(active);
}

/**
 * Push updated content (typically an overrun flip) to the running Live Activity
 * and the home widget. No-op if nothing is running.
 */
export function updateSessionActivity(active: ActiveSession): void {
  if (!SUPPORTED) return;
  try {
    void currentActivity?.update(activityPropsFor(active)).catch(() => {});
  } catch {
    // best-effort
  }
  reloadHomeWidget(active);
}

/**
 * End the Live Activity and flip the home widget back to its idle prompt.
 * No-op if nothing is running.
 */
export function endSessionActivity(): void {
  if (!SUPPORTED) return;
  try {
    void currentActivity?.end('default').catch(() => {});
  } catch {
    // best-effort
  } finally {
    currentActivity = null;
  }
  reloadHomeWidget(null);
}

/** Explicit home-widget reload (e.g. on app foreground or overrun tick). */
export function reloadSessionWidget(active: ActiveSession | null): void {
  reloadHomeWidget(active);
}
