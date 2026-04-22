import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const mem = new Map<string, string>();
const memStorage: StateStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => { mem.set(k, v); },
  removeItem: (k) => { mem.delete(k); },
};

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  AsyncStorage = null;
}

let asyncBroken = false;

const wrapped: StateStorage = {
  async getItem(k) {
    if (!AsyncStorage || asyncBroken) return memStorage.getItem(k);
    try {
      return await AsyncStorage.getItem(k);
    } catch {
      asyncBroken = true;
      return memStorage.getItem(k);
    }
  },
  async setItem(k, v) {
    if (!AsyncStorage || asyncBroken) return memStorage.setItem(k, v);
    try {
      await AsyncStorage.setItem(k, v);
    } catch {
      asyncBroken = true;
      memStorage.setItem(k, v);
    }
  },
  async removeItem(k) {
    if (!AsyncStorage || asyncBroken) return memStorage.removeItem(k);
    try {
      await AsyncStorage.removeItem(k);
    } catch {
      asyncBroken = true;
      memStorage.removeItem(k);
    }
  },
};

export const safeStorage = createJSONStorage(() => wrapped);
