import * as SecureStore from 'expo-secure-store';

const KEY = 'playbox.seen_station_tour';

export async function hasSeenTour(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function markTourSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, '1');
  } catch {
    // swallow — flag will just not persist this run
  }
}
