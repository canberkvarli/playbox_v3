export type Sport = 'football' | 'basketball' | 'volleyball' | 'tennis';

export type Station = {
  id: string;
  name: string;
  city: 'istanbul' | 'ankara' | 'izmir';
  lat: number;
  lng: number;
  sports: Sport[];
  stock: Partial<Record<Sport, number>>;
  availableNow: boolean;
};

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

export const STATIONS: Station[] = [
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
};
