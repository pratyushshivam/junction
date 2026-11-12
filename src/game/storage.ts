/** localStorage that never throws (private windows, blocked storage). */

const PREFIX = "junction.";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* the game works without it */
  }
}

export function loadNumber(key: string): number {
  const n = Number(load(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
