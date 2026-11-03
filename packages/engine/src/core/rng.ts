/**
 * Seeded random numbers for game code: sfc32, integer-only, so every platform
 * produces the same sequence. This is the only randomness a deterministic game may use.
 */
export interface Rng {
  /** Integer in [0, n). */
  int(n: number): number;
  /** Integer in [min, max] (inclusive). */
  range(min: number, max: number): number;
  /** Float in [0, 1), from 32 random bits. */
  float(): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** A random element; undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Generator state: four unsigned 32-bit integers. Hashed and snapshotted with the world. */
  state(): [number, number, number, number];
  setState(state: readonly number[]): void;
}

export function createRng(seed: number): Rng {
  // splitmix32 spreads one seed over the four state words.
  let z = seed >>> 0;
  const split = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let a = split(), b = split(), c = split(), d = split();
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < 12; i++) next(); // warm up
  const rng: Rng = {
    int(n) {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`rng.int needs a positive integer, got ${n}`);
      return Math.floor((next() / 4294967296) * n);
    },
    range: (min, max) => min + rng.int(max - min + 1),
    float: () => next() / 4294967296,
    chance: (p) => next() / 4294967296 < p,
    pick: (items) => (items.length ? items[rng.int(items.length)] : undefined),
    state: () => [a, b, c, d],
    setState(s) {
      if (s.length !== 4) throw new Error("rng state needs four integers");
      [a, b, c, d] = s.map((v) => v >>> 0) as [number, number, number, number];
    },
  };
  return rng;
}
