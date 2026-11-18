// A small seeded random number generator (mulberry32): the same seed always gives the same
// city, the same traffic pattern and the same screenshot, which is what makes the deterministic
// ?shot= scenes repeatable. No unseeded Math.random() is used anywhere in the simulation.
export function createRandom(seed) {
  let state = seed | 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one item from an array with the seeded generator. */
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

/** A number in [min, max) from the seeded generator. */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** An integer in [min, max] from the seeded generator. */
export function intRange(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}
