import * as WebBrowser from 'expo-web-browser';

// Hosted legal pages (playbox-web repo). Temporary Vercel alias —
// TODO: swap to https://playboxsport.com once the domain is purchased and attached.
export const LEGAL_BASE_URL = 'https://playbox-web-iota.vercel.app';

export const LEGAL_URLS = {
  kvkk: `${LEGAL_BASE_URL}/kvkk`,
  privacy: `${LEGAL_BASE_URL}/privacy`,
  terms: `${LEGAL_BASE_URL}/terms`,
} as const;

export function openLegal(doc: keyof typeof LEGAL_URLS) {
  return WebBrowser.openBrowserAsync(LEGAL_URLS[doc]).catch(() => {});
}
