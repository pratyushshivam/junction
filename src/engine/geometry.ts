export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

/** Turn `from` toward `to` by at most `maxStep` radians, the short way round. */
export function rotateToward(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  if (Math.abs(d) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * maxStep);
}

export function distPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function segmentsCross(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const d1 = cross(a2.x - a1.x, a2.y - a1.y, b1.x - a1.x, b1.y - a1.y);
  const d2 = cross(a2.x - a1.x, a2.y - a1.y, b2.x - a1.x, b2.y - a1.y);
  const d3 = cross(b2.x - b1.x, b2.y - b1.y, a1.x - b1.x, a1.y - b1.y);
  const d4 = cross(b2.x - b1.x, b2.y - b1.y, a2.x - b1.x, a2.y - b1.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Shortest distance between two line segments in the plane. */
export function distSegments(a1: Vec, a2: Vec, b1: Vec, b2: Vec): number {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointSegment(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y),
    distPointSegment(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y),
    distPointSegment(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y),
    distPointSegment(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y),
  );
}
