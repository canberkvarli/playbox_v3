import { SPORT_LABELS, type Station } from '@/data/stations.seed';
import { haversineKm } from '@/lib/geo';

/**
 * Turkish-aware normalization: lowercase with tr locale, strip diacritics,
 * so "kadıköy" matches "kadikoy" / "KADIKÖY".
 */
function norm(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let k = 0; k <= b.length; k++) prev[k] = curr[k];
  }
  return prev[b.length];
}

/**
 * String match score, 0..1. Rules, highest wins:
 *   1.00 — exact
 *   0.85 — starts with query
 *   0.70 — any word starts with query
 *   0.55 — substring
 *   0.40 — fuzzy (Levenshtein ≤ 2), only when query ≥ 4 chars
 */
function stringScore(hay: string, needle: string): number {
  if (!needle) return 0;
  if (hay === needle) return 1;
  if (hay.startsWith(needle)) return 0.85;
  if (hay.split(/\s+/).some((w) => w.startsWith(needle))) return 0.7;
  if (hay.includes(needle)) return 0.55;
  if (needle.length >= 4) {
    const d = levenshtein(hay, needle);
    if (d <= 2) return Math.max(0.4 - d * 0.1, 0.2);
  }
  return 0;
}

export type ScoredStation = { station: Station; score: number };

/**
 * Score a single station against a query. Combines name + sport label matches
 * with an availability boost and a distance penalty. Returns 0 when nothing
 * matches — caller filters those out.
 */
export function scoreStation(
  station: Station,
  rawQuery: string,
  userLoc: { lat: number; lng: number } | null
): number {
  const q = norm(rawQuery);
  if (!q) return 0;

  const nameScore = stringScore(norm(station.name), q);
  const sportScore = Math.max(
    0,
    ...station.sports.map((sp) => stringScore(norm(SPORT_LABELS[sp] ?? sp), q))
  );

  const base = Math.max(nameScore, sportScore * 0.85);
  if (base === 0) return 0;

  const avail = station.availableNow ? 0.08 : 0;
  const dist = userLoc
    ? Math.min(0.15, haversineKm(userLoc, { lat: station.lat, lng: station.lng }) * 0.01)
    : 0;

  return base + avail - dist;
}

/**
 * Rank a list of stations by match against `query`. When query is empty,
 * returns the input unchanged (caller decides default ordering).
 */
export function rankStations(
  stations: Station[],
  query: string,
  userLoc: { lat: number; lng: number } | null
): Station[] {
  if (!norm(query)) return stations;
  const scored: ScoredStation[] = stations
    .map((s) => ({ station: s, score: scoreStation(s, query, userLoc) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.station);
}
