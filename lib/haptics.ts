import * as Haptics from 'expo-haptics';

export const hx = {
  tap:   () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  punch: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  yes:   () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  no:    () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};
