import * as Haptics from 'expo-haptics';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const hx = {
  tap:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  punch: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  yes:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  no:    () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  /**
   * Distinctive "2 minutes left" buzz — a rising triple pulse (warning →
   * medium → heavy) that feels unlike a normal tap, so the user notices even
   * with the phone in a pocket. Foreground only (JS can't run a haptic while
   * suspended); the scheduled local notification + its custom sound covers the
   * backgrounded case.
   */
  alert2min: async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await wait(150);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await wait(130);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch {
      /* haptics best-effort — never throw into UI */
    }
  },

  /**
   * "Session finished" buzz — a firm double pulse resolving into success, so
   * the end-of-session feels distinct from the 2-minute warning.
   */
  alertDone: async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await wait(160);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* haptics best-effort — never throw into UI */
    }
  },
};
