import { gatesForStation, unlockGateId, type Station } from './stations.seed';

// A realistic multi-sport station. The bug under test: the unlock path used to
// build the gate_id from the SPORT'S ORDINAL in `station.sports`
// (`sports.indexOf(sport) + 1`) instead of the reserved gate's number within
// the sport stock. For volleyball (ordinal index 1 → ordinal 2) that produced
// `...-volleyball-2`, which never matches a reservation holding
// `...-volleyball-1`.
const STATION: Station = {
  id: 'ist-kadikoy',
  name: 'Kadıköy',
  city: 'istanbul',
  lat: 0,
  lng: 0,
  sports: ['football', 'volleyball', 'tennis'],
  stock: { football: 1, volleyball: 4, tennis: 2 },
  availableNow: true,
};

describe('unlockGateId — reservation slug parity', () => {
  test('unlock slug equals the RESERVED gate id for a non-first sport (volleyball gate 1)', () => {
    // What the reserve flow holds: the first free volleyball gate's id.
    const reservedSlug = gatesForStation(STATION, 'volleyball')[0].id;
    expect(reservedSlug).toBe('ist-kadikoy-volleyball-1');

    // What the unlock path now sends, given gate number 1 (the reserved gate).
    const unlockSlug = unlockGateId(STATION.id, 'volleyball', 1);

    expect(unlockSlug).toBe(reservedSlug);
    // Explicitly pin that it is NOT the sport-ordinal slug the old bug produced.
    const sportOrdinal = STATION.sports.indexOf('volleyball') + 1; // → 2
    expect(unlockSlug).not.toBe(`ist-kadikoy-volleyball-${sportOrdinal}`);
  });

  test('matches every gate from gatesForStation across all sports', () => {
    for (const sport of STATION.sports) {
      const gates = gatesForStation(STATION, sport);
      gates.forEach((gate, i) => {
        expect(unlockGateId(STATION.id, sport, i + 1)).toBe(gate.id);
      });
    }
  });

  test('clamps invalid gate numbers to 1 instead of emitting -0/-NaN', () => {
    expect(unlockGateId('DEV-001', 'football', 0)).toBe('DEV-001-football-1');
    expect(unlockGateId('DEV-001', 'football', NaN)).toBe('DEV-001-football-1');
    expect(unlockGateId('DEV-001', 'football', -3)).toBe('DEV-001-football-1');
  });
});
