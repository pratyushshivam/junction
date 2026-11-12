/** The difficulty curve: pure functions of how far the round has got. */

export type Kind = "car" | "van" | "truck";

export interface KindSpec {
  length: number;
  width: number;
  /** World units per second. */
  speed: number;
}

export const KINDS: Record<Kind, KindSpec> = {
  car: { length: 9, width: 5.2, speed: 15 },
  van: { length: 11.5, width: 5.6, speed: 12.5 },
  truck: { length: 16.5, width: 6, speed: 10 },
};

export const MAX_BAYS = 5;

/** How many bays are open once `score` vehicles have been delivered. */
export function baysForScore(score: number): number {
  if (score >= 18) return 5;
  if (score >= 10) return 4;
  if (score >= 4) return 3;
  return 2;
}

/**
 * Seconds between arrival `n` and the one after it. Starts near six seconds,
 * tightens steadily, and later on sometimes sends two almost together.
 * `u` is a random number in [0, 1).
 */
export function gapAfter(n: number, u: number): number {
  const base = Math.max(1.15, 5.6 * Math.pow(0.966, n));
  const pairChance = n < 10 ? 0 : Math.min(0.3, (n - 9) * 0.012);
  if (u < pairChance) return 0.7;
  return base * (0.85 + 0.3 * u);
}

/** Which vehicle arrival `n` is: cars first, then vans, then trucks join. */
export function kindFor(n: number, u: number): Kind {
  if (n < 2) return "car";
  if (n < 7) return u < 0.65 ? "car" : "van";
  if (u < 0.42) return "car";
  return u < 0.74 ? "van" : "truck";
}
