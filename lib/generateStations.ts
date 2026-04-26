import type { Station, Sport } from '@/data/stations.seed';

const DEMO_NAMES_TR = [
  'Merkez Parkı',
  'Sahil Sporları',
  'Meydan Spot',
  'Kültür Park',
  'Gençlik Sahası',
  'Yeşil Vadi',
  'Bahar Parkı',
  'Kule Meydanı',
  'Doğa Alanı',
  'Çarşı Spor',
  'Köşk Park',
  'Hilal Sahası',
];

const ALL_SPORTS: Sport[] = ['football', 'basketball', 'volleyball', 'tennis'];

/**
 * Convert meters to degrees of latitude/longitude at a given latitude.
 * 1 deg of latitude ~= 111.32 km anywhere on Earth.
 * 1 deg of longitude varies with latitude: 111.32 * cos(lat) km.
 */
function metersToLatDeg(m: number): number {
  return m / 111_320;
}
function metersToLngDeg(m: number, atLatDeg: number): number {
  const lat = (atLatDeg * Math.PI) / 180;
  return m / (111_320 * Math.cos(lat));
}

/**
 * Generate N demo stations in a ring + scatter around a center point.
 * Each station sits 150m–2km from the center at a pseudo-random bearing.
 * Deterministic per center so the same location always produces the same
 * layout (prevents "stations jumping around" on reload).
 */
export function generateStationsAround(
  center: { lat: number; lng: number },
  count = 10
): Station[] {
  // Deterministic RNG seeded from the center coords so same place → same stations.
  // Good enough: xorshift32 with a 32-bit seed derived from lat+lng.
  const seed = Math.floor(((center.lat + 90) * 1000 + (center.lng + 180)) * 1000) | 0;
  let state = seed || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };

  const stations: Station[] = [];
  for (let i = 0; i < count; i++) {
    // Ring distance: 150m inner, 2000m outer, biased slightly toward the middle.
    const r = 150 + rand() * 1850;
    // Bearing evenly spread + jitter so they don't form a perfect circle.
    const bearing = (i / count) * 2 * Math.PI + (rand() - 0.5) * (Math.PI / 3);

    const dLat = metersToLatDeg(r * Math.sin(bearing));
    const dLng = metersToLngDeg(r * Math.cos(bearing), center.lat);
    const lat = center.lat + dLat;
    const lng = center.lng + dLng;

    // Pick 1–3 sports deterministically
    const sportCount = 1 + Math.floor(rand() * 3);
    const shuffled = [...ALL_SPORTS].sort(() => rand() - 0.5);
    const sports = shuffled.slice(0, sportCount);

    const stock: Partial<Record<Sport, number>> = {};
    for (const s of sports) stock[s] = Math.floor(rand() * 6); // 0–5

    const availableNow = Object.values(stock).some((n) => (n ?? 0) > 0);

    stations.push({
      id: `gen-${i}-${Math.floor(center.lat * 1000)}-${Math.floor(center.lng * 1000)}`,
      name: DEMO_NAMES_TR[i % DEMO_NAMES_TR.length],
      city: 'istanbul', // placeholder — station.city isn't user-visible on the map; profile hardcodes city
      lat,
      lng,
      sports,
      stock,
      availableNow,
    });
  }
  return stations;
}

/**
 * Merge seed stations that are within `radiusKm` of the user with generated
 * demo stations so the map always shows something useful. If there are fewer
 * than `minTotal` stations near the user, top up with generated ones.
 */
export function stationsNearUser(
  userLoc: { lat: number; lng: number } | null,
  seed: Station[],
  opts: { minTotal?: number; radiusKm?: number } = {}
): Station[] {
  const minTotal = opts.minTotal ?? 10;
  const radiusKm = opts.radiusKm ?? 5;

  if (!userLoc) {
    // No location — just return seed (will show Turkish cities)
    return seed;
  }

  // Haversine inline so this module is self-contained
  const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const nearbySeed = seed.filter((s) =>
    haversineKm(userLoc, { lat: s.lat, lng: s.lng }) <= radiusKm
  );

  if (nearbySeed.length >= minTotal) {
    return nearbySeed;
  }

  const generated = generateStationsAround(userLoc, minTotal - nearbySeed.length);
  return [...nearbySeed, ...generated];
}
