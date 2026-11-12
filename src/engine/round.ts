/**
 * The whole game as a pure, deterministic simulation. No DOM, no clocks, no
 * Math.random: a round is a seed, a field shape and the paths the player draws.
 */
import { baysForScore, gapAfter, kindFor, KINDS, MAX_BAYS, type Kind } from "./difficulty";
import { clamp, distPointSegment, distSegments, rotateToward, wrapAngle, type Vec } from "./geometry";
import { mulberry32 } from "./rng";

/** Fixed time step, in seconds. */
export const STEP = 1 / 60;
/** The field always has this area, whatever its shape, so traffic is as dense on a phone as on a laptop. */
export const AREA = 16000;
export const MIN_ASPECT = 0.45;
export const MAX_ASPECT = 2.1;
/** Vehicles keep their centres this far inside the field edge. */
export const INSET = 5;
/** A free vehicle starts turning back this far from the inset line. */
const TURN_ZONE = 8;
/** Seconds of warning before a vehicle drives in. */
export const LEAD = 2.4;
/** A line ending this close to the matching bay snaps to it. */
export const SNAP = 7.5;
export const PARK_TIME = 0.8;
const MIN_POINT_GAP = 1.2;
const TURN_RADIUS = 5;
const BODY_TURN_RATE = 7;
const WARN_EVERY = 4;

export const BAY_WIDTH = 11;
export const BAY_HEIGHT = 15;

/** Bay centres as fractions of the field, so the same layout works in any shape. */
export const BAY_LAYOUT: readonly { u: number; v: number }[] = [
  { u: 0.27, v: 0.32 },
  { u: 0.73, v: 0.68 },
  { u: 0.73, v: 0.3 },
  { u: 0.27, v: 0.7 },
  { u: 0.5, v: 0.5 },
];

/** 0 top, 1 right, 2 bottom, 3 left. */
export type Edge = 0 | 1 | 2 | 3;

export interface Bay {
  id: number;
  x: number;
  y: number;
  open: boolean;
}

export type Phase = "entering" | "driving" | "parking";

export interface Vehicle {
  id: number;
  kind: Kind;
  /** The bay this vehicle is tagged for. */
  bay: number;
  x: number;
  y: number;
  /** Direction of travel, radians. */
  dir: number;
  /** Where the body points; eases toward `dir`. */
  heading: number;
  /** The direction a free vehicle is steering toward. */
  want: number;
  phase: Phase;
  /** The drawn line, in world units. `next` is the first point not yet reached. */
  path: Vec[];
  next: number;
  /** The line ends in the matching bay. */
  locked: boolean;
  /** The player is still drawing this line. */
  drawing: boolean;
  /** Seconds spent parking. */
  parkT: number;
  /** Seconds since it drove in. */
  age: number;
}

export interface Arrival {
  n: number;
  edge: Edge;
  kind: Kind;
  bay: number;
  /** Where on the edge it will appear. */
  x: number;
  y: number;
  dir: number;
  /** Seconds until it drives in. */
  eta: number;
}

export type GameEvent =
  | { type: "announce"; arrival: Arrival }
  | { type: "spawn"; id: number }
  | { type: "deliver"; id: number; bay: number; x: number; y: number }
  | { type: "bay"; bay: number }
  | { type: "crash"; a: number; b: number; x: number; y: number };

export interface RoundOptions {
  /** One vehicle at a time: the next only comes once the field is empty. Used for teaching. */
  calm?: boolean;
  /** Set false to let vehicles pass through each other (tests and demos). */
  collide?: boolean;
}

export interface Round {
  seed: number;
  width: number;
  height: number;
  time: number;
  tick: number;
  score: number;
  over: boolean;
  calm: boolean;
  collide: boolean;
  bays: Bay[];
  openBays: number;
  vehicles: Vehicle[];
  /** Announced, not yet on the field. */
  arrivals: Arrival[];
  /** Pairs of vehicle ids about to meet. */
  warnings: [number, number][];
  /** Filled by `step`; the caller reads and empties it. */
  events: GameEvent[];
  crash: { a: number; b: number; x: number; y: number } | null;
  /** Arrivals announced so far. */
  count: number;
  untilAnnounce: number;
  nextId: number;
  lastEdge: number;
  lastT: number;
  rand: () => number;
}

export function fieldSize(aspect: number): { width: number; height: number } {
  const a = clamp(aspect, MIN_ASPECT, MAX_ASPECT);
  return { width: Math.sqrt(AREA * a), height: Math.sqrt(AREA / a) };
}

export function createRound(seed: number, aspect: number, options: RoundOptions = {}): Round {
  const { width, height } = fieldSize(aspect);
  const bays: Bay[] = BAY_LAYOUT.slice(0, MAX_BAYS).map((p, id) => ({
    id,
    x: p.u * width,
    y: p.v * height,
    open: id < baysForScore(0),
  }));
  return {
    seed,
    width,
    height,
    time: 0,
    tick: 0,
    score: 0,
    over: false,
    calm: options.calm ?? false,
    collide: options.collide ?? true,
    bays,
    openBays: baysForScore(0),
    vehicles: [],
    arrivals: [],
    warnings: [],
    events: [],
    crash: null,
    count: 0,
    untilAnnounce: 0.6,
    nextId: 1,
    lastEdge: -1,
    lastT: 0,
    rand: mulberry32(seed),
  };
}

export function findVehicle(r: Round, id: number): Vehicle | undefined {
  return r.vehicles.find((v) => v.id === id);
}

/** Put a vehicle straight onto the field. The game itself only uses arrivals; this is for tests and demos. */
export function addVehicle(
  r: Round,
  init: { kind?: Kind; bay?: number; x: number; y: number; dir: number },
): Vehicle {
  const v: Vehicle = {
    id: r.nextId++,
    kind: init.kind ?? "car",
    bay: init.bay ?? 0,
    x: init.x,
    y: init.y,
    dir: init.dir,
    heading: init.dir,
    want: init.dir,
    phase: "driving",
    path: [],
    next: 0,
    locked: false,
    drawing: false,
    parkT: 0,
    age: 0,
  };
  r.vehicles.push(v);
  return v;
}

/* ---------- drawing a line ---------- */

/** Start a fresh line on a vehicle; any old line is dropped. */
export function beginPath(r: Round, id: number): boolean {
  const v = findVehicle(r, id);
  if (!v || v.phase === "parking" || r.over) return false;
  v.path = [{ x: v.x, y: v.y }];
  v.next = 1;
  v.locked = false;
  v.drawing = true;
  return true;
}

export type ExtendResult = "ignored" | "added" | "locked";

/** Add a point to the line being drawn. Returns "locked" when it reaches the matching bay. */
export function extendPath(r: Round, id: number, point: Vec): ExtendResult {
  const v = findVehicle(r, id);
  if (!v || !v.drawing || v.locked || v.phase === "parking" || r.over) return "ignored";
  const p = {
    x: clamp(point.x, INSET, r.width - INSET),
    y: clamp(point.y, INSET, r.height - INSET),
  };
  const last = v.path[v.path.length - 1] ?? { x: v.x, y: v.y };
  const bay = r.bays[v.bay];
  if (bay && bay.open) {
    const near =
      Math.hypot(p.x - bay.x, p.y - bay.y) < SNAP ||
      distPointSegment(bay.x, bay.y, last.x, last.y, p.x, p.y) < SNAP * 0.7;
    if (near) {
      v.path.push({ x: bay.x, y: bay.y });
      v.locked = true;
      v.drawing = false;
      return "locked";
    }
  }
  if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_GAP) return "ignored";
  v.path.push(p);
  return "added";
}

/** The finger lifted. The vehicle finishes the line, then carries on straight. */
export function endPath(r: Round, id: number): void {
  const v = findVehicle(r, id);
  if (v) v.drawing = false;
}

/* ---------- arrivals ---------- */

function announce(r: Round): void {
  const n = r.count++;
  // Always five draws per arrival, so the sequence depends only on the seed.
  const uEdge = r.rand();
  const uPos = r.rand();
  const uKind = r.rand();
  const uBay = r.rand();
  const uGap = r.rand();

  let edge = Math.floor(uEdge * 4) as Edge;
  const t = 0.14 + uPos * 0.72;
  // Never two in a row through the same gap: send the second in from the far side.
  if (edge === r.lastEdge && Math.abs(t - r.lastT) < 0.22) edge = ((edge + 2) % 4) as Edge;
  r.lastEdge = edge;
  r.lastT = t;

  const kind = kindFor(n, uKind);
  const bay = Math.min(r.openBays - 1, Math.floor(uBay * r.openBays));
  let x = 0;
  let y = 0;
  let dir = 0;
  if (edge === 0) {
    x = t * r.width;
    dir = Math.PI / 2;
  } else if (edge === 1) {
    x = r.width;
    y = t * r.height;
    dir = Math.PI;
  } else if (edge === 2) {
    x = t * r.width;
    y = r.height;
    dir = -Math.PI / 2;
  } else {
    y = t * r.height;
  }
  const arrival: Arrival = { n, edge, kind, bay, x, y, dir, eta: n === 0 ? 1.4 : LEAD };
  r.arrivals.push(arrival);
  r.events.push({ type: "announce", arrival });
  r.untilAnnounce += gapAfter(n, uGap);
}

function spawn(r: Round, a: Arrival): void {
  const back = KINDS[a.kind].length / 2 + 0.5;
  const v = addVehicle(r, {
    kind: a.kind,
    bay: a.bay,
    x: a.x - Math.cos(a.dir) * back,
    y: a.y - Math.sin(a.dir) * back,
    dir: a.dir,
  });
  v.phase = "entering";
  r.events.push({ type: "spawn", id: v.id });
}

/* ---------- movement ---------- */

function inside(r: Round, x: number, y: number): boolean {
  return x >= INSET && x <= r.width - INSET && y >= INSET && y <= r.height - INSET;
}

function driveFree(r: Round, v: Vehicle, distance: number, dt: number): void {
  const speed = KINDS[v.kind].speed;
  if (v.phase === "driving") {
    const lo = INSET + TURN_ZONE;
    if (v.x < lo && Math.cos(v.want) < 0) v.want = wrapAngle(Math.PI - v.want);
    if (v.x > r.width - lo && Math.cos(v.want) > 0) v.want = wrapAngle(Math.PI - v.want);
    if (v.y < lo && Math.sin(v.want) < 0) v.want = wrapAngle(-v.want);
    if (v.y > r.height - lo && Math.sin(v.want) > 0) v.want = wrapAngle(-v.want);
  }
  const diff = wrapAngle(v.want - v.dir);
  const maxTurn = (speed / TURN_RADIUS) * dt;
  if (Math.abs(diff) > Math.PI - 0.05) {
    // A full about-turn: swing toward the middle of the field.
    const side =
      Math.cos(v.dir) * (r.height / 2 - v.y) - Math.sin(v.dir) * (r.width / 2 - v.x) >= 0 ? 1 : -1;
    v.dir = wrapAngle(v.dir + side * maxTurn);
  } else {
    v.dir = rotateToward(v.dir, v.want, maxTurn);
  }
  v.x += Math.cos(v.dir) * distance;
  v.y += Math.sin(v.dir) * distance;
}

function park(r: Round, v: Vehicle): void {
  v.phase = "parking";
  v.parkT = 0;
  v.path = [];
  v.next = 0;
  v.drawing = false;
  r.score++;
  r.events.push({ type: "deliver", id: v.id, bay: v.bay, x: v.x, y: v.y });
  const open = baysForScore(r.score);
  while (r.openBays < open) {
    const bay = r.bays[r.openBays];
    if (bay) bay.open = true;
    r.events.push({ type: "bay", bay: r.openBays });
    r.openBays++;
  }
}

function move(r: Round, v: Vehicle): void {
  if (v.phase === "parking") {
    v.parkT += STEP;
    // Straighten up in the slot: bays stand upright, so point up or down, whichever is nearer.
    const target = Math.sin(v.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    v.heading = rotateToward(v.heading, target, 5 * STEP);
    return;
  }
  v.age += STEP;
  let remaining = KINDS[v.kind].speed * STEP;
  while (remaining > 0 && v.next < v.path.length) {
    const target = v.path[v.next]!;
    const dx = target.x - v.x;
    const dy = target.y - v.y;
    const d = Math.hypot(dx, dy);
    if (d <= remaining) {
      if (d > 1e-6) v.dir = Math.atan2(dy, dx);
      v.x = target.x;
      v.y = target.y;
      remaining -= d;
      v.next++;
    } else {
      v.dir = Math.atan2(dy, dx);
      v.x += (dx / d) * remaining;
      v.y += (dy / d) * remaining;
      remaining = 0;
    }
    v.want = v.dir;
  }
  if (v.next >= v.path.length) {
    if (v.locked) {
      park(r, v);
      return;
    }
    if (!v.drawing && v.path.length > 0) {
      v.path = [];
      v.next = 0;
    }
    if (remaining > 0) driveFree(r, v, remaining, (remaining / KINDS[v.kind].speed) || 0);
  }
  if (v.next > 48) {
    v.path.splice(0, v.next);
    v.next = 0;
  }
  if (v.phase === "entering") {
    if (inside(r, v.x, v.y)) v.phase = "driving";
  } else {
    v.x = clamp(v.x, INSET, r.width - INSET);
    v.y = clamp(v.y, INSET, r.height - INSET);
  }
  v.heading = rotateToward(v.heading, v.dir, BODY_TURN_RATE * STEP);
}

/* ---------- collisions and warnings ---------- */

/** The spine of a vehicle's body; with its half width this makes a capsule. */
function spine(v: Vehicle): [Vec, Vec, number] {
  const spec = KINDS[v.kind];
  const half = (spec.length - spec.width) / 2;
  const cx = Math.cos(v.heading) * half;
  const cy = Math.sin(v.heading) * half;
  return [{ x: v.x - cx, y: v.y - cy }, { x: v.x + cx, y: v.y + cy }, (spec.width / 2) * 0.9];
}

export function touching(a: Vehicle, b: Vehicle): boolean {
  const [a1, a2, ra] = spine(a);
  const [b1, b2, rb] = spine(b);
  return distSegments(a1, a2, b1, b2) < ra + rb;
}

/** Where a vehicle will be in `t` seconds if nothing changes; null if it will have parked. */
export function predict(r: Round, v: Vehicle, t: number): Vec | null {
  let remaining = KINDS[v.kind].speed * t;
  let x = v.x;
  let y = v.y;
  let dir = v.dir;
  for (let i = v.next; i < v.path.length && remaining > 0; i++) {
    const p = v.path[i]!;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= remaining) {
      if (d > 1e-6) dir = Math.atan2(p.y - y, p.x - x);
      x = p.x;
      y = p.y;
      remaining -= d;
    } else {
      x += ((p.x - x) / d) * remaining;
      y += ((p.y - y) / d) * remaining;
      remaining = 0;
    }
  }
  if (remaining > 0) {
    if (v.locked) return null;
    x += Math.cos(dir) * remaining;
    y += Math.sin(dir) * remaining;
  }
  if (v.phase === "driving") {
    x = clamp(x, INSET, r.width - INSET);
    y = clamp(y, INSET, r.height - INSET);
  }
  return { x, y };
}

function findWarnings(r: Round): void {
  r.warnings = [];
  const live = r.vehicles.filter((v) => v.phase !== "parking");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      const reach = (KINDS[a.kind].length + KINDS[b.kind].length) * 0.42;
      for (let t = 0.3; t <= 1.81; t += 0.3) {
        const pa = predict(r, a, t);
        const pb = predict(r, b, t);
        if (!pa || !pb) break;
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < reach) {
          r.warnings.push([a.id, b.id]);
          break;
        }
      }
    }
  }
}

function findCrash(r: Round): void {
  const live = r.vehicles.filter((v) => v.phase !== "parking");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (!touching(a, b)) continue;
      r.over = true;
      r.crash = { a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      r.warnings = [[a.id, b.id]];
      r.events.push({ type: "crash", ...r.crash });
      return;
    }
  }
}

/* ---------- one tick ---------- */

/** Advance the round by one fixed step. Does nothing once the round is over. */
export function step(r: Round): void {
  if (r.over) return;
  r.time += STEP;
  r.tick++;

  const held = r.calm && r.vehicles.length + r.arrivals.length > 0;
  if (!held) {
    if (r.calm) r.untilAnnounce = Math.min(r.untilAnnounce, 0.7);
    r.untilAnnounce -= STEP;
    if (r.untilAnnounce <= 0) announce(r);
  }

  for (let i = r.arrivals.length - 1; i >= 0; i--) {
    const a = r.arrivals[i]!;
    a.eta -= STEP;
    if (a.eta <= 0) {
      r.arrivals.splice(i, 1);
      spawn(r, a);
    }
  }

  for (const v of r.vehicles) move(r, v);
  for (let i = r.vehicles.length - 1; i >= 0; i--) {
    const v = r.vehicles[i]!;
    if (v.phase === "parking" && v.parkT >= PARK_TIME) r.vehicles.splice(i, 1);
  }

  if (r.collide) findCrash(r);
  if (!r.over && r.tick % WARN_EVERY === 0) {
    if (r.collide) findWarnings(r);
    else r.warnings = [];
  }
  if (r.events.length > 512) r.events.splice(0, r.events.length - 512);
}

/** A plain copy of everything that matters, for comparing two runs. */
export function snapshot(r: Round): string {
  return JSON.stringify({
    time: r.time,
    score: r.score,
    over: r.over,
    openBays: r.openBays,
    count: r.count,
    vehicles: r.vehicles.map((v) => [v.id, v.kind, v.bay, v.x, v.y, v.dir, v.phase]),
    arrivals: r.arrivals.map((a) => [a.n, a.edge, a.kind, a.bay, a.x, a.y, a.eta]),
  });
}
