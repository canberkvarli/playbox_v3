export type Sport = 'football' | 'basketball' | 'volleyball' | 'paddle' | 'tennis';

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

export const STATIONS: Station[] = [
  // İstanbul (16)
  { id: 'ist-taksim',       name: 'Taksim Meydanı',     city: 'istanbul', lat: 41.0370, lng: 28.9850, sports: ['football', 'basketball'],            stock: { football: 3, basketball: 2 },                       availableNow: true  },
  { id: 'ist-kadikoy',      name: 'Kadıköy Moda',       city: 'istanbul', lat: 40.9851, lng: 29.0264, sports: ['football', 'volleyball', 'paddle'], stock: { football: 1, volleyball: 4, paddle: 2 },            availableNow: true  },
  { id: 'ist-besiktas',     name: 'Beşiktaş İskele',    city: 'istanbul', lat: 41.0420, lng: 29.0093, sports: ['basketball', 'tennis'],              stock: { basketball: 0, tennis: 3 },                         availableNow: false },
  { id: 'ist-moda-park',    name: 'Moda Sahili',         city: 'istanbul', lat: 40.9787, lng: 29.0289, sports: ['volleyball', 'paddle'],              stock: { volleyball: 5, paddle: 3 },                         availableNow: true  },
  { id: 'ist-bebek',        name: 'Bebek Sahili',        city: 'istanbul', lat: 41.0782, lng: 29.0418, sports: ['football', 'paddle'],                stock: { football: 2, paddle: 4 },                           availableNow: true  },
  { id: 'ist-macka',        name: 'Maçka Parkı',         city: 'istanbul', lat: 41.0481, lng: 28.9956, sports: ['football', 'basketball'],            stock: { football: 4, basketball: 3 },                       availableNow: true  },
  { id: 'ist-cadde-bostan', name: 'Caddebostan',         city: 'istanbul', lat: 40.9572, lng: 29.0608, sports: ['volleyball', 'tennis'],              stock: { volleyball: 2, tennis: 4 },                         availableNow: true  },
  { id: 'ist-bagdat',       name: 'Bağdat Caddesi',      city: 'istanbul', lat: 40.9614, lng: 29.0614, sports: ['basketball', 'tennis'],              stock: { basketball: 1, tennis: 2 },                         availableNow: true  },
  { id: 'ist-levent',       name: 'Levent Spor',         city: 'istanbul', lat: 41.0792, lng: 29.0167, sports: ['football', 'tennis'],                stock: { football: 0, tennis: 1 },                           availableNow: false },
  { id: 'ist-atasehir',     name: 'Ataşehir Park',       city: 'istanbul', lat: 40.9857, lng: 29.1268, sports: ['football', 'basketball'],            stock: { football: 5, basketball: 2 },                       availableNow: true  },
  { id: 'ist-uskudar',      name: 'Üsküdar Sahil',       city: 'istanbul', lat: 41.0234, lng: 29.0146, sports: ['volleyball', 'paddle'],              stock: { volleyball: 3, paddle: 2 },                         availableNow: true  },
  { id: 'ist-yenikoy',      name: 'Yeniköy',             city: 'istanbul', lat: 41.1158, lng: 29.0577, sports: ['paddle'],                            stock: { paddle: 6 },                                        availableNow: true  },
  { id: 'ist-fenerbahce',   name: 'Fenerbahçe Parkı',    city: 'istanbul', lat: 40.9697, lng: 29.0367, sports: ['football', 'tennis'],                stock: { football: 2, tennis: 3 },                           availableNow: true  },
  { id: 'ist-emirgan',      name: 'Emirgan Korusu',      city: 'istanbul', lat: 41.1063, lng: 29.0556, sports: ['football', 'volleyball'],            stock: { football: 1, volleyball: 2 },                       availableNow: true  },
  { id: 'ist-zorlu',        name: 'Zorlu Center',        city: 'istanbul', lat: 41.0670, lng: 29.0163, sports: ['basketball'],                        stock: { basketball: 4 },                                    availableNow: true  },
  { id: 'ist-galata',       name: 'Galata Köprüsü',      city: 'istanbul', lat: 41.0202, lng: 28.9737, sports: ['football'],                          stock: { football: 0 },                                      availableNow: false },

  // Ankara (8)
  { id: 'ank-kugulu',       name: 'Kuğulu Park',         city: 'ankara',   lat: 39.9047, lng: 32.8623, sports: ['football', 'volleyball', 'tennis'], stock: { football: 3, volleyball: 2, tennis: 4 },            availableNow: true  },
  { id: 'ank-tunali',       name: 'Tunalı Hilmi',        city: 'ankara',   lat: 39.9075, lng: 32.8606, sports: ['basketball', 'tennis'],              stock: { basketball: 2, tennis: 3 },                         availableNow: true  },
  { id: 'ank-cankaya',      name: 'Çankaya Köşkü',       city: 'ankara',   lat: 39.8932, lng: 32.8589, sports: ['football'],                          stock: { football: 4 },                                      availableNow: true  },
  { id: 'ank-odtu',         name: 'ODTÜ Yurtlar',        city: 'ankara',   lat: 39.8927, lng: 32.7833, sports: ['football', 'basketball'],            stock: { football: 5, basketball: 3 },                       availableNow: true  },
  { id: 'ank-genclik',      name: 'Gençlik Parkı',       city: 'ankara',   lat: 39.9412, lng: 32.8530, sports: ['volleyball', 'paddle'],              stock: { volleyball: 1, paddle: 2 },                         availableNow: true  },
  { id: 'ank-bilkent',      name: 'Bilkent Stadı',       city: 'ankara',   lat: 39.8744, lng: 32.7493, sports: ['football', 'tennis'],                stock: { football: 0, tennis: 2 },                           availableNow: false },
  { id: 'ank-armada',       name: 'Armada AVM Spor',     city: 'ankara',   lat: 39.9128, lng: 32.8076, sports: ['basketball'],                        stock: { basketball: 6 },                                    availableNow: true  },
  { id: 'ank-eskisehir',    name: 'Eskişehir Yolu',      city: 'ankara',   lat: 39.9000, lng: 32.7800, sports: ['volleyball'],                        stock: { volleyball: 3 },                                    availableNow: true  },

  // İzmir (6)
  { id: 'izm-kordon',       name: 'Kordon',              city: 'izmir',    lat: 38.4276, lng: 27.1426, sports: ['volleyball', 'paddle', 'tennis'],   stock: { volleyball: 4, paddle: 3, tennis: 2 },              availableNow: true  },
  { id: 'izm-alsancak',     name: 'Alsancak Sahili',     city: 'izmir',    lat: 38.4357, lng: 27.1428, sports: ['football', 'volleyball'],            stock: { football: 2, volleyball: 5 },                       availableNow: true  },
  { id: 'izm-bostanli',     name: 'Bostanlı Vapur',      city: 'izmir',    lat: 38.4576, lng: 27.0987, sports: ['paddle'],                            stock: { paddle: 4 },                                        availableNow: true  },
  { id: 'izm-karsiyaka',    name: 'Karşıyaka Sahil',     city: 'izmir',    lat: 38.4625, lng: 27.1180, sports: ['football', 'basketball'],            stock: { football: 1, basketball: 2 },                       availableNow: true  },
  { id: 'izm-konak',        name: 'Konak Meydanı',       city: 'izmir',    lat: 38.4192, lng: 27.1287, sports: ['basketball', 'tennis'],              stock: { basketball: 0, tennis: 1 },                         availableNow: false },
  { id: 'izm-buca',         name: 'Buca Hipodrom',       city: 'izmir',    lat: 38.3915, lng: 27.1751, sports: ['football', 'tennis'],                stock: { football: 3, tennis: 2 },                           availableNow: true  },
];

export const SPORT_LABELS: Record<Sport, string> = {
  football: 'futbol',
  basketball: 'basket',
  volleyball: 'voleybol',
  paddle: 'paddle',
  tennis: 'tenis',
};

export const CITY_LABELS: Record<Station['city'], string> = {
  istanbul: 'İstanbul',
  ankara: 'Ankara',
  izmir: 'İzmir',
};
