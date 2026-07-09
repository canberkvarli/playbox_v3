/**
 * Fun, game-y default name generator (Hearthstone / matchmaking flavor).
 *
 * Replaces the old boring `oyuncu_<id>` handles with playful
 * adjective + noun (+ number) combos like "TurboOtter" / "sneaky_baller47".
 *
 * IMPORTANT — determinism: the output is seeded off the user id, NOT
 * `Math.random()`. `useDisplayUser` recomputes the fallback name on every
 * render, so a truly random generator would make the header flicker between
 * names each frame. Seeding off the stable user id gives every user ONE
 * consistent fun name, while a large word matrix keeps collisions rare
 * (52 adjectives × 52 nouns × 100 = ~270k combos).
 */

// Sporty / playful adjectives — clean, upbeat, game-y.
const ADJECTIVES = [
  'Turbo', 'Sneaky', 'Cosmic', 'Midnight', 'Electric', 'Golden', 'Savage',
  'Mighty', 'Nimble', 'Blazing', 'Frosty', 'Rowdy', 'Clutch', 'Rapid',
  'Feral', 'Wild', 'Sonic', 'Atomic', 'Radical', 'Zesty', 'Lucky',
  'Rogue', 'Stealth', 'Vivid', 'Neon', 'Chrome', 'Lunar', 'Solar',
  'Thunder', 'Velvet', 'Crimson', 'Jade', 'Iron', 'Swift', 'Bouncy',
  'Dizzy', 'Grumpy', 'Cheeky', 'Fuzzy', 'Spicy', 'Wonky', 'Zany',
  'Epic', 'Prime', 'Hyper', 'Mega', 'Ultra', 'Quantum', 'Phantom',
  'Bold', 'Fierce', 'Slick',
];

// Nouns — mostly sport / court / arcade critters and archetypes.
const NOUNS = [
  'Otter', 'Baller', 'Dunker', 'Spiker', 'Striker', 'Sprinter', 'Falcon',
  'Panther', 'Rhino', 'Cobra', 'Tiger', 'Wolf', 'Hawk', 'Bison',
  'Comet', 'Rocket', 'Bolt', 'Blaze', 'Titan', 'Ranger', 'Nomad',
  'Viper', 'Raptor', 'Bandit', 'Maverick', 'Champ', 'Ace', 'Rookie',
  'Legend', 'Ninja', 'Wizard', 'Goblin', 'Yeti', 'Kraken', 'Phoenix',
  'Dragon', 'Badger', 'Mongoose', 'Jackal', 'Lynx', 'Puma', 'Gecko',
  'Narwhal', 'Walrus', 'Moose', 'Bull', 'Stallion', 'Hornet', 'Shark',
  'Eagle', 'Cheetah', 'Jaguar',
];

/**
 * Deterministic 32-bit hash (FNV-1a). Same input → same output, so a given
 * user always maps to the same fun name.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Pull the adjective/noun/number for a seed. All three derive from distinct
// slices of the hash so they vary independently.
function parts(seed: string): { adj: string; noun: string; num: number } {
  const h = hash(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  const num = h % 100; // 0–99
  return { adj, noun, num };
}

/**
 * A clean, `@handle`-friendly username: lowercase, underscore-joined, with a
 * trailing number. Matches the app's handle convention (shown as `@…`, no
 * capitals, digits allowed — cf. the `mert_42` placeholder).
 *
 * Same name & signature as the old `defaultUsername` so all call sites keep
 * working unchanged.
 *
 * e.g. "turbo_otter47", "sneaky_baller3"
 */
export function defaultUsername(userId: string): string {
  const { adj, noun, num } = parts(userId);
  return `${adj.toLowerCase()}_${noun.toLowerCase()}${num}`;
}

/**
 * A freeform, capitalized display name (no number) — the friendly label shown
 * in headers when the user hasn't set their own.
 *
 * e.g. "Turbo Otter", "Sneaky Baller"
 */
export function defaultDisplayName(userId: string): string {
  const { adj, noun } = parts(userId);
  return `${adj} ${noun}`;
}
