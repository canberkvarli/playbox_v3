export type Sport = 'football' | 'basketball' | 'volleyball' | 'tennis';

export type Station = {
  id: string;
  name: string;
  city: 'istanbul' | 'ankara' | 'izmir' | 'dalyan';
  lat: number;
  lng: number;
  sports: Sport[];
  stock: Partial<Record<Sport, number>>;
  availableNow: boolean;
};

/**
 * REAL stations — the ones with a physical locker bolted up somewhere a stranger
 * can walk to. In production the map shows ONLY these, and nothing else in the
 * app resolves to anything else (see findRealStation).
 *
 * Every other row in STATIONS is a DEVELOPMENT FIXTURE: invented name, invented
 * coordinates, no hardware. They exist so the map can be worked on without
 * driving to a court. They are not inventory, not a roadmap, and must never
 * reach a user or an App Store reviewer — showing a reviewer a dozen invented
 * stations is what earned the Guideline 2.2 rejection on build 45.
 *
 * Add an id here the day its hardware goes live, and remove it the day the unit
 * comes off the wall. Emptying this set gives a truthfully empty production map,
 * which is the correct state when nothing is installed.
 */
export const REAL_STATION_IDS = new Set<string>(['DEV-001']);
export const isRealStation = (id: string) => REAL_STATION_IDS.has(id);

/**
 * Resolve a station id that came from OUTSIDE the app — today that means a
 * scanned QR code, the one place an arbitrary id can be injected.
 *
 * In production this only ever resolves a station with a locker physically
 * installed. The other ~30 rows below are development fixtures, and a user who
 * scanned a crafted code should get "station not found" rather than be walked
 * into a reservation flow for a park that has no Playbox in it.
 *
 * In dev it resolves the whole fixture set, so bench testing is unaffected.
 *
 * Ids that originate INSIDE the app (a pin the user tapped on the map) are
 * already constrained to real stations by the map itself, so those lookups do
 * not need this.
 */
export function findRealStation(id: string): Station | null {
  const s = STATIONS.find((x) => x.id === id);
  if (!s) return null;
  if (!__DEV__ && !REAL_STATION_IDS.has(s.id)) return null;
  return s;
}

export type Gate = {
  /** Stable, globally unique identifier — used as reservations.gate_id. */
  id: string;
  /** User-facing short label (e.g. "1", "2"). */
  label: string;
  sport: Sport;
};

/**
 * Returns the named gates for a (station, sport) pair, derived from the
 * `stock` count. Format: `${station.id}-${sport}-${1..stock}`.
 *
 * Auto-derivation lets us keep the seed data simple while the reservation
 * system enforces specific-gate uniqueness server-side. When stations gain
 * physical-gate metadata (named courts, specific lockers), this helper is
 * the one place to upgrade — callers will pick it up automatically.
 */
export function gatesForStation(station: Station, sport: Sport): Gate[] {
  const count = station.stock[sport] ?? 0;
  return Array.from({ length: count }, (_, i) => ({
    id: `${station.id}-${sport}-${i + 1}`,
    label: String(i + 1),
    sport,
  }));
}

/**
 * Canonical reservation-linkage slug for a specific gate, used as
 * `reservations.gate_id` AND replayed at unlock time so sign-unlock's
 * `link-session` can match `r.gate_id === gateId` EXACTLY.
 *
 * Format mirrors `gatesForStation`: `${station.id}-${sport}-${gateNumber}`.
 * `gateNumber` is the 1-indexed gate within the sport's STOCK (the actual
 * compartment the user reserved/unlocked) — NEVER the sport's ordinal in
 * `station.sports`. Conflating the two was the linkage bug: e.g. on a station
 * with sports `['football','volleyball','tennis']`, volleyball gate 1 must
 * produce `...-volleyball-1`, not `...-volleyball-2` (its sport ordinal).
 *
 * Both producers of the slug — the reserve flow (`selectedGate.id`) and the
 * unlock flow — route through this one helper so they can never drift.
 */
export function unlockGateId(
  stationId: string,
  sport: Sport,
  gateNumber: number,
): string {
  // Clamp to a valid 1-indexed gate. A non-finite or <1 input falls back to
  // gate 1 (the single-gate common case) rather than emitting a `-0`/`-NaN`
  // slug that could never match a real reservation.
  const n = Number.isFinite(gateNumber) && gateNumber >= 1 ? Math.floor(gateNumber) : 1;
  return `${stationId}-${sport}-${n}`;
}

export const STATIONS: Station[] = [
  // ---- The one physical unit (matches firmware station_id "DEV-001") -------
  //
  // The one physical unit: Sanatçılar Parkı Spor Sahası, Ataköy 3. Kısım,
  // Bakırköy. Coordinates measured at the mounting point itself.
  //
  // This row is the ENTIRE public map (generated fixtures are dev-only), so its
  // name and coordinates are a claim that a stranger can walk to that spot and
  // rent a ball. Keep it true: if the unit moves or comes off the wall, change
  // this row or drop DEV-001 from REAL_STATION_IDS the same day. A user who
  // walks to the pin and finds nothing is the Guideline 2.2 rejection again.
  { id: 'DEV-001',          name: 'Sanatçılar Parkı Spor Sahası', city: 'istanbul', lat: 40.980174, lng: 28.863615, sports: ['football', 'basketball', 'volleyball'], stock: { football: 1, basketball: 1, volleyball: 1 }, availableNow: true  },
  // { id: 'DEV-001',          name: 'Playbox Dev Workshop',       city: 'dalyan', lat: 36.8336737, lng: 28.64972, sports: ['football', 'basketball', 'volleyball'], stock: { football: 1, basketball: 1, volleyball: 1 }, availableNow: true  },

  // İstanbul (16)
  { id: 'ist-taksim',       name: 'Taksim Spor Kulübü',         city: 'istanbul', lat: 41.0370, lng: 28.9850, sports: ['football', 'basketball'],            stock: { football: 3, basketball: 2 },              availableNow: true  },
  { id: 'ist-kadikoy',      name: 'Kadıköy Moda Spor Vakfı',    city: 'istanbul', lat: 40.9851, lng: 29.0264, sports: ['football', 'volleyball', 'tennis'],  stock: { football: 1, volleyball: 4, tennis: 2 },   availableNow: true  },
  { id: 'ist-besiktas',     name: 'Beşiktaş Sahil Sporları',    city: 'istanbul', lat: 41.0420, lng: 29.0093, sports: ['basketball', 'tennis'],              stock: { basketball: 0, tennis: 3 },                availableNow: false },
  { id: 'ist-moda-park',    name: 'Moda Sahil Spor Alanı',      city: 'istanbul', lat: 40.9787, lng: 29.0289, sports: ['volleyball', 'basketball'],          stock: { volleyball: 5, basketball: 3 },            availableNow: true  },
  { id: 'ist-bebek',        name: 'Bebek Sporcular Derneği',    city: 'istanbul', lat: 41.0782, lng: 29.0418, sports: ['football', 'volleyball'],            stock: { football: 2, volleyball: 4 },              availableNow: true  },
  { id: 'ist-macka',        name: 'Maçka Demokrasi Parkı',      city: 'istanbul', lat: 41.0481, lng: 28.9956, sports: ['football', 'basketball'],            stock: { football: 4, basketball: 3 },              availableNow: true  },
  { id: 'ist-cadde-bostan', name: 'Caddebostan Spor Tesisleri', city: 'istanbul', lat: 40.9572, lng: 29.0608, sports: ['volleyball', 'tennis'],              stock: { volleyball: 2, tennis: 4 },                availableNow: true  },
  { id: 'ist-bagdat',       name: 'Bağdat Caddesi Aktivite',    city: 'istanbul', lat: 40.9614, lng: 29.0614, sports: ['basketball', 'tennis'],              stock: { basketball: 1, tennis: 2 },                availableNow: true  },
  { id: 'ist-levent',       name: 'Levent Plaza Spor',          city: 'istanbul', lat: 41.0792, lng: 29.0167, sports: ['football', 'tennis'],                stock: { football: 0, tennis: 1 },                  availableNow: false },
  { id: 'ist-atasehir',     name: 'Ataşehir Mahalle Sahası',    city: 'istanbul', lat: 40.9857, lng: 29.1268, sports: ['football', 'basketball'],            stock: { football: 5, basketball: 2 },              availableNow: true  },
  { id: 'ist-uskudar',      name: 'Üsküdar Şemsipaşa Sahili',   city: 'istanbul', lat: 41.0234, lng: 29.0146, sports: ['volleyball', 'tennis'],              stock: { volleyball: 3, tennis: 2 },                availableNow: true  },
  { id: 'ist-yenikoy',      name: 'Yeniköy Tekne Kulübü',       city: 'istanbul', lat: 41.1158, lng: 29.0577, sports: ['volleyball'],                        stock: { volleyball: 6 },                           availableNow: true  },
  { id: 'ist-fenerbahce',   name: 'Fenerbahçe Sahil Tesisi',    city: 'istanbul', lat: 40.9697, lng: 29.0367, sports: ['football', 'tennis'],                stock: { football: 2, tennis: 3 },                  availableNow: true  },
  { id: 'ist-emirgan',      name: 'Emirgan Korusu Spor Alanı',  city: 'istanbul', lat: 41.1063, lng: 29.0556, sports: ['football', 'volleyball'],            stock: { football: 1, volleyball: 2 },              availableNow: true  },
  { id: 'ist-zorlu',        name: 'Zorlu Center Aktif',         city: 'istanbul', lat: 41.0670, lng: 29.0163, sports: ['basketball'],                        stock: { basketball: 4 },                           availableNow: true  },
  { id: 'ist-galata',       name: 'Galata Sahil Spor',          city: 'istanbul', lat: 41.0202, lng: 28.9737, sports: ['football'],                          stock: { football: 0 },                             availableNow: false },

  // Ankara (8)
  { id: 'ank-kugulu',       name: 'Kuğulu Park Spor Vakfı',     city: 'ankara',   lat: 39.9047, lng: 32.8623, sports: ['football', 'volleyball', 'tennis'], stock: { football: 3, volleyball: 2, tennis: 4 },   availableNow: true  },
  { id: 'ank-tunali',       name: 'Tunalı Hilmi Spor Kulübü',   city: 'ankara',   lat: 39.9075, lng: 32.8606, sports: ['basketball', 'tennis'],              stock: { basketball: 2, tennis: 3 },                availableNow: true  },
  { id: 'ank-cankaya',      name: 'Çankaya Botanik Spor',       city: 'ankara',   lat: 39.8932, lng: 32.8589, sports: ['football'],                          stock: { football: 4 },                             availableNow: true  },
  { id: 'ank-odtu',         name: 'ODTÜ Kampüs Sporları',       city: 'ankara',   lat: 39.8927, lng: 32.7833, sports: ['football', 'basketball'],            stock: { football: 5, basketball: 3 },              availableNow: true  },
  { id: 'ank-genclik',      name: 'Gençlik Parkı Sahası',       city: 'ankara',   lat: 39.9412, lng: 32.8530, sports: ['volleyball', 'basketball'],          stock: { volleyball: 1, basketball: 2 },            availableNow: true  },
  { id: 'ank-bilkent',      name: 'Bilkent Üniversite Sporu',   city: 'ankara',   lat: 39.8744, lng: 32.7493, sports: ['football', 'tennis'],                stock: { football: 0, tennis: 2 },                  availableNow: false },
  { id: 'ank-armada',       name: 'Armada Spor Merkezi',        city: 'ankara',   lat: 39.9128, lng: 32.8076, sports: ['basketball'],                        stock: { basketball: 6 },                           availableNow: true  },
  { id: 'ank-eskisehir',    name: 'Eskişehir Yolu Aktif',       city: 'ankara',   lat: 39.9000, lng: 32.7800, sports: ['volleyball'],                        stock: { volleyball: 3 },                           availableNow: true  },

  // İzmir (6)
  { id: 'izm-kordon',       name: 'Kordon Spor Vakfı',          city: 'izmir',    lat: 38.4276, lng: 27.1426, sports: ['volleyball', 'basketball', 'tennis'], stock: { volleyball: 4, basketball: 3, tennis: 2 }, availableNow: true  },
  { id: 'izm-alsancak',     name: 'Alsancak Sahil Sporcuları',  city: 'izmir',    lat: 38.4357, lng: 27.1428, sports: ['football', 'volleyball'],            stock: { football: 2, volleyball: 5 },              availableNow: true  },
  { id: 'izm-bostanli',     name: 'Bostanlı Vapur İskelesi',    city: 'izmir',    lat: 38.4576, lng: 27.0987, sports: ['volleyball'],                        stock: { volleyball: 4 },                           availableNow: true  },
  { id: 'izm-karsiyaka',    name: 'Karşıyaka Sahil Spor',       city: 'izmir',    lat: 38.4625, lng: 27.1180, sports: ['football', 'basketball'],            stock: { football: 1, basketball: 2 },              availableNow: true  },
  { id: 'izm-konak',        name: 'Konak Belediyesi Aktif',     city: 'izmir',    lat: 38.4192, lng: 27.1287, sports: ['basketball', 'tennis'],              stock: { basketball: 0, tennis: 1 },                availableNow: false },
  { id: 'izm-buca',         name: 'Buca Hipodrom Tesisi',       city: 'izmir',    lat: 38.3915, lng: 27.1751, sports: ['football', 'tennis'],                stock: { football: 3, tennis: 2 },                  availableNow: true  },
];

export const SPORT_LABELS: Record<Sport, string> = {
  football: 'futbol',
  basketball: 'basket',
  volleyball: 'voleybol',
  tennis: 'tenis',
};

export const CITY_LABELS: Record<Station['city'], string> = {
  istanbul: 'İstanbul',
  ankara: 'Ankara',
  izmir: 'İzmir',
  dalyan: 'Dalyan',
};
