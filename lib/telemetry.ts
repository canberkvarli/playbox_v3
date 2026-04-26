/**
 * Telemetry shim. Wraps Sentry so the rest of the app calls one stable API
 * (`reportError`, `track`, `setUser`) regardless of what's plugged in
 * underneath.
 *
 * Sentry is intentionally optional — if `@sentry/react-native` isn't
 * installed or `EXPO_PUBLIC_SENTRY_DSN` isn't set, every call here becomes a
 * dev-only console log so the app keeps running.
 *
 * To wire up Sentry for real:
 *   1.  yarn add @sentry/react-native
 *   2.  Set EXPO_PUBLIC_SENTRY_DSN in your env / EAS secrets
 *   3.  Run `npx pod-install` and rebuild the dev client
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let Sentry: any = null;
let initialised = false;

function loadSentry(): any | null {
  if (Sentry !== null) return Sentry;
  try {
    Sentry = require('@sentry/react-native');
    return Sentry;
  } catch {
    Sentry = false;
    return null;
  }
}

export function initTelemetry() {
  if (initialised) return;
  initialised = true;
  if (!DSN) {
    if (__DEV__) console.info('[telemetry] no DSN, skipping init');
    return;
  }
  const s = loadSentry();
  if (!s?.init) {
    if (__DEV__) console.warn('[telemetry] @sentry/react-native not installed');
    return;
  }
  try {
    s.init({
      dsn: DSN,
      enableNative: true,
      enableAutoSessionTracking: true,
      tracesSampleRate: 0.2,
      // Drop noisy / privacy-sensitive frames before they leave the device.
      beforeSend: (event: any) => {
        if (event?.request?.headers) delete event.request.headers.Authorization;
        return event;
      },
    });
  } catch (e) {
    if (__DEV__) console.warn('[telemetry] init failed', e);
  }
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (__DEV__) console.error('[telemetry] error', error, context);
  const s = loadSentry();
  if (!s?.captureException) return;
  try {
    s.captureException(error, context ? { extra: context } : undefined);
  } catch {}
}

export function track(eventName: string, props?: Record<string, unknown>) {
  if (__DEV__) console.log('[telemetry] event', eventName, props);
  const s = loadSentry();
  if (!s?.addBreadcrumb) return;
  try {
    s.addBreadcrumb({
      category: 'app',
      message: eventName,
      level: 'info',
      data: props,
    });
  } catch {}
}

export function setUser(user: { id: string; phone?: string } | null) {
  const s = loadSentry();
  if (!s?.setUser) return;
  try {
    if (user) s.setUser({ id: user.id });
    else s.setUser(null);
  } catch {}
}
