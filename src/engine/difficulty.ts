/** The difficulty curve: pure functions of how far the round has got. */

export type Kind = "car" | "van" | "truck";

export interface KindSpec {
  length: number;
  width: number;
  /** World units per second. */
  speed: number;
}

export const KINDS: Record<Kind, KindSpec> = {
  car: { length: 11, width: 6.4, speed: 14 },
  van: { length: 13.5, width: 6.8, speed: 12 },
  truck: { length: 18.5, width: 7.2, speed: 10 },
};

export const MAX_BAYS = 5;
/** Bumps a round allows: the last one ends it. */
export const LIVES = 3;

/** How many bays are open once `score` vehicles have been delivered. */
export function baysForScore(score: number): number {
  if (score >= 24) return 5;
  if (score >= 13) return 4;
  if (score >= 5) return 3;
  return 2;
}

/**
 * Seconds between arrival `n` and the one after it. Starts near six seconds,
 * tightens steadily, and later on sometimes sends two almost together.
 * `u` is a random number in [0, 1).
 */
export function gapAfter(n: number, u: number): number {
  const base = Math.max(1.4, 5.8 * Math.pow(0.972, n));
  const pairChance = n < 14 ? 0 : Math.min(0.25, (n - 13) * 0.01);
  if (u < pairChance) return 0.9;
  return base * (0.85 + 0.3 * u);
}

/** Which vehicle arrival `n` is: cars first, then vans, then trucks join. */
export function kindFor(n: number, u: number): Kind {
  if (n < 2) return "car";
  if (n < 9) return u < 0.65 ? "car" : "van";
  if (u < 0.42) return "car";
  return u < 0.74 ? "van" : "truck";
}
