import { describe, expect, it } from "vitest";
import {
  addVehicle,
  baysForScore,
  beginPath,
  createRound,
  dailySeed,
  endPath,
  extendPath,
  fieldSize,
  gapAfter,
  INSET,
  KINDS,
  kindFor,
  mulberry32,
  snapshot,
  step,
  type Round,
  type Vehicle,
} from "../src/engine";

function run(r: Round, seconds: number, each?: (r: Round) => void): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    step(r);
    each?.(r);
  }
}

/** Draw a straight line from a vehicle to its bay, as a finger would. */
function drawToBay(r: Round, v: Vehicle): string {
  const bay = r.bays[v.bay]!;
  beginPath(r, v.id);
  let result = "ignored";
  for (let i = 1; i <= 40 && result !== "locked"; i++) {
    const k = i / 40;
    result = extendPath(r, v.id, { x: v.x + (bay.x - v.x) * k, y: v.y + (bay.y - v.y) * k });
  }
  endPath(r, v.id);
  return result;
}

describe("seeded rounds", () => {
  it("gives the same numbers for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("plays out identically from the same seed, and differently from another", () => {
    const play = (seed: number): string => {
      const r = createRound(seed, 1.6, { collide: false });
      run(r, 60, (round) => {
        // The same scripted player both times: send every third vehicle home.
        if (round.tick % 90 === 0) {
          const v = round.vehicles.find((c) => c.phase === "driving" && c.id % 3 === 0 && !c.locked);
          if (v) drawToBay(round, v);
        }
      });
      return snapshot(r);
    };
    expect(play(7)).toBe(play(7));
    expect(play(7)).not.toBe(play(8));
  });

  it("gives every player the same day, and each day its own round", () => {
    expect(dailySeed("2026-11-13")).toBe(dailySeed("2026-11-13"));
    expect(dailySeed("2026-11-13")).not.toBe(dailySeed("2026-11-14"));
  });

  it("announces the same arrivals whatever the screen shape", () => {
    const order = (aspect: number): string => {
      const r = createRound(99, aspect, { collide: false });
      const seen: string[] = [];
      run(r, 40, (round) => {
        for (const e of round.events) {
          if (e.type === "announce") seen.push(`${e.arrival.edge}:${e.arrival.kind}:${e.arrival.bay}`);
        }
        round.events.length = 0;
      });
      return seen.join(" ");
    };
    expect(order(0.5)).toBe(order(1.8));
  });
});

describe("drawing a path", () => {
  it("delivers a vehicle whose line reaches its bay", () => {
    const r = createRound(1, 1.6);
    const v = addVehicle(r, { x: 20, y: 20, dir: 0, bay: 1 });
    expect(drawToBay(r, v)).toBe("locked");
    run(r, 12);
    expect(r.score).toBe(1);
    expect(r.vehicles.some((c) => c.id === v.id)).toBe(false);
  });

  it("does not snap to a bay of another colour", () => {
    const r = createRound(1, 1.6);
    const v = addVehicle(r, { x: 20, y: 20, dir: 0, bay: 1 });
    const wrong = r.bays[0]!;
    beginPath(r, v.id);
    expect(extendPath(r, v.id, { x: wrong.x, y: wrong.y })).toBe("added");
    endPath(r, v.id);
    run(r, 8);
    expect(r.score).toBe(0);
  });

  it("replaces the old line when a new one is drawn", () => {
    const r = createRound(1, 1.6);
    const v = addVehicle(r, { x: 80, y: 50, dir: 0, bay: 0 });
    drawToBay(r, v);
    expect(v.locked).toBe(true);
    beginPath(r, v.id);
    extendPath(r, v.id, { x: 120, y: 80 });
    endPath(r, v.id);
    expect(v.locked).toBe(false);
    expect(v.path.length).toBe(2);
  });

  it("opens more bays as the score rises", () => {
    const r = createRound(3, 1.6, { collide: false });
    expect(r.bays.filter((b) => b.open).length).toBe(2);
    run(r, 150, (round) => {
      for (const v of round.vehicles) {
        if (v.phase === "driving" && !v.locked) drawToBay(round, v);
      }
    });
    expect(r.score).toBeGreaterThan(18);
    expect(r.bays.every((b) => b.open)).toBe(true);
  });
});

describe("crashes", () => {
  it("ends the round when two vehicles meet head on", () => {
    const r = createRound(1, 1.6);
    const a = addVehicle(r, { x: 40, y: 50, dir: 0 });
    const b = addVehicle(r, { x: 110, y: 50, dir: Math.PI });
    run(r, 6);
    expect(r.over).toBe(true);
    expect(r.crash).not.toBeNull();
    expect([r.crash!.a, r.crash!.b].sort()).toEqual([a.id, b.id].sort());
  });

  it("warns before the crash happens", () => {
    const r = createRound(1, 1.6);
    addVehicle(r, { x: 40, y: 50, dir: 0 });
    addVehicle(r, { x: 110, y: 50, dir: Math.PI });
    let warnedAt = -1;
    run(r, 6, (round) => {
      if (warnedAt < 0 && !round.over && round.warnings.length > 0) warnedAt = round.time;
    });
    expect(warnedAt).toBeGreaterThan(0);
    expect(r.time - warnedAt).toBeGreaterThan(1);
  });

  it("lets two vehicles pass when their lanes are apart", () => {
    const r = createRound(1, 1.6, { calm: true });
    addVehicle(r, { x: 40, y: 40, dir: 0 });
    addVehicle(r, { x: 110, y: 52, dir: Math.PI });
    run(r, 4);
    expect(r.over).toBe(false);
  });

  it("stops the clock once the round is over", () => {
    const r = createRound(1, 1.6);
    addVehicle(r, { x: 40, y: 50, dir: 0 });
    addVehicle(r, { x: 60, y: 50, dir: Math.PI });
    run(r, 5);
    const frozen = snapshot(r);
    run(r, 5);
    expect(snapshot(r)).toBe(frozen);
  });
});

describe("the field", () => {
  it("keeps the same area in every shape", () => {
    for (const aspect of [0.5, 1, 1.6, 2]) {
      const { width, height } = fieldSize(aspect);
      expect(width * height).toBeCloseTo(16000, 6);
      expect(width / height).toBeCloseTo(aspect, 6);
    }
  });

  it("never lets a vehicle leave, with or without a line", () => {
    for (const aspect of [0.5, 1, 1.9]) {
      for (const seed of [1, 2, 3, 4]) {
        // Calm mode sends one vehicle at a time, so it can roam for minutes without a crash.
        const r = createRound(seed, aspect, { calm: true });
        const half = KINDS.truck.length / 2 + 1;
        let driven = 0;
        run(r, 200, (round) => {
          for (const v of round.vehicles) {
            if (v.phase === "entering") {
              expect(v.x).toBeGreaterThan(-half);
              expect(v.x).toBeLessThan(round.width + half);
              expect(v.y).toBeGreaterThan(-half);
              expect(v.y).toBeLessThan(round.height + half);
              continue;
            }
            driven++;
            expect(v.x).toBeGreaterThanOrEqual(INSET);
            expect(v.x).toBeLessThanOrEqual(round.width - INSET);
            expect(v.y).toBeGreaterThanOrEqual(INSET);
            expect(v.y).toBeLessThanOrEqual(round.height - INSET);
          }
          // Now and then, scribble a line that tries to run off the field.
          if (round.tick % 400 === 0) {
            const v = round.vehicles[0];
            if (v && v.phase === "driving") {
              beginPath(round, v.id);
              extendPath(round, v.id, { x: -500, y: round.height / 2 });
              extendPath(round, v.id, { x: round.width + 500, y: -500 });
              endPath(round, v.id);
            }
          }
        });
        expect(driven).toBeGreaterThan(1000);
      }
    }
  });

  it("turns a free vehicle back at the edge", () => {
    const r = createRound(1, 1.6, { calm: true });
    const v = addVehicle(r, { x: 30, y: 50, dir: Math.PI });
    run(r, 6);
    expect(Math.cos(v.dir)).toBeGreaterThan(0.9);
    expect(v.x).toBeGreaterThan(30);
  });
});

describe("difficulty", () => {
  it("shortens the gap between arrivals as the round goes on", () => {
    expect(gapAfter(0, 0.5)).toBeGreaterThan(5);
    for (let n = 1; n < 60; n++) {
      expect(gapAfter(n, 0.5)).toBeLessThanOrEqual(gapAfter(n - 1, 0.5));
    }
    expect(gapAfter(60, 0.5)).toBeLessThan(1.3);
  });

  it("starts with cars and two bays, then adds more", () => {
    expect(kindFor(0, 0.99)).toBe("car");
    expect(kindFor(4, 0.99)).toBe("van");
    expect(kindFor(20, 0.99)).toBe("truck");
    expect(baysForScore(0)).toBe(2);
    for (let s = 1; s < 40; s++) expect(baysForScore(s)).toBeGreaterThanOrEqual(baysForScore(s - 1));
    expect(baysForScore(40)).toBe(5);
  });

  it("sends far more traffic late in a round than early", () => {
    const r = createRound(11, 1.6, { collide: false });
    let early = 0;
    let late = 0;
    run(r, 150, (round) => {
      for (const e of round.events) {
        if (e.type !== "spawn") continue;
        if (round.time < 40) early++;
        if (round.time >= 110) late++;
      }
      round.events.length = 0;
      for (const v of round.vehicles) {
        if (v.phase === "driving" && !v.locked) drawToBay(round, v);
      }
    });
    expect(early).toBeLessThan(12);
    expect(late).toBeGreaterThan(early * 2);
  });
});
