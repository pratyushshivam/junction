/**
 * The ghost finger. In a real round it only shows the gesture (Teacher); on the
 * start screen it actually draws the lines, so the page demonstrates itself (Autopilot).
 */
import { beginPath, endPath, extendPath, findVehicle, type Round, type Vec, type Vehicle } from "../engine";
import type { Ghost } from "./draw";
import { tagFor } from "./palette";

function ease(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/** A gentle arc from a to b; `bend` is the sideways bulge as a fraction of the distance. */
export function arc(a: Vec, b: Vec, bend: number, t: number): Vec {
  const mx = (a.x + b.x) / 2 - (b.y - a.y) * bend;
  const my = (a.y + b.y) / 2 + (b.x - a.x) * bend;
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * mx + t * t * b.x,
    y: u * u * a.y + 2 * u * t * my + t * t * b.y,
  };
}

function idle(v: Vehicle): boolean {
  return v.phase === "driving" && !v.locked && !v.drawing && v.next >= v.path.length;
}

/** Shows, on a loop, a finger dragging from the waiting vehicle to its bay. Changes nothing. */
export class Teacher {
  private t = 0;

  update(dt: number, round: Round): Ghost | null {
    const v = round.vehicles.find(idle);
    if (!v || v.age < 0.5) {
      this.t = 0;
      return null;
    }
    const bay = round.bays[v.bay];
    if (!bay) return null;
    this.t = (this.t + dt) % 2.5;
    const k = ease(this.t / 1.3);
    let alpha = Math.min(1, this.t / 0.15);
    if (this.t > 1.7) alpha = Math.max(0, 1 - (this.t - 1.7) / 0.35);
    const trail: Vec[] = [];
    const n = Math.max(1, Math.round(k * 28));
    for (let i = 0; i <= n; i++) trail.push(arc(v, bay, 0.16, (i / n) * k));
    const tip = trail[trail.length - 1]!;
    return { x: tip.x, y: tip.y, alpha, trail, color: tagFor(v.bay).color };
  }
}

/** Plays the start-screen demo: picks up each vehicle and draws it home. */
export class Autopilot {
  private id = -1;
  private t = 0;
  private sent = 0;
  private from: Vec = { x: 0, y: 0 };
  private bend = 0.2;
  private tip: Vec = { x: 0, y: 0 };

  reset(): void {
    this.id = -1;
  }

  update(dt: number, round: Round): Ghost | null {
    if (this.id < 0) {
      const v = round.vehicles.find((c) => idle(c) && c.age > 1.1);
      if (!v) return null;
      this.id = v.id;
      this.t = 0;
      this.sent = 0;
      this.from = { x: v.x, y: v.y };
      this.tip = this.from;
      this.bend = -this.bend;
      beginPath(round, v.id);
    }
    const v = findVehicle(round, this.id);
    if (!v || v.phase === "parking") {
      this.id = -1;
      return null;
    }
    const bay = round.bays[v.bay];
    if (!bay) return null;
    this.t += dt;
    const steps = 36;
    const k = ease(this.t / 1.25);
    while (v.drawing && this.sent < Math.floor(k * steps)) {
      this.sent++;
      extendPath(round, v.id, arc(this.from, bay, this.bend, this.sent / steps));
    }
    if (this.t >= 1.25 && v.drawing) {
      extendPath(round, v.id, bay);
      endPath(round, v.id);
    }
    if (v.drawing) this.tip = arc(this.from, bay, this.bend, k);
    else this.tip = { x: bay.x, y: bay.y };
    const alpha = Math.min(1, this.t / 0.15) * (this.t > 1.35 ? Math.max(0, 1 - (this.t - 1.35) / 0.3) : 1);
    if (alpha <= 0) return null;
    return { x: this.tip.x, y: this.tip.y, alpha, trail: [], color: tagFor(v.bay).color };
  }
}
