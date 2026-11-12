/** Canvas renderer. Reads a Round and draws it; keeps only cosmetic state (bursts, shake). */
import {
  BAY_SIZE,
  KINDS,
  LEAD,
  PARK_TIME,
  type Arrival,
  type GameEvent,
  type Round,
  type Vec,
  type Vehicle,
} from "../engine";
import { INK, ink, PAPER, tagFor, traceShape, WHITE, YARD } from "./palette";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The ghost finger that shows how to draw a line. */
export interface Ghost {
  x: number;
  y: number;
  alpha: number;
  trail: Vec[];
  color: string;
}

type Effect =
  | { kind: "ring"; x: number; y: number; t: number; life: number; from: number; to: number; color: string }
  | { kind: "plus"; x: number; y: number; t: number; life: number; color: string }
  | { kind: "poof"; x: number; y: number; t: number; life: number; stay: boolean };

const YARD_RADIUS = 3;

function ease(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

function easeOutBack(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  scale = 1;
  private ox = 0;
  private oy = 0;
  private fx: Effect[] = [];
  private shake = 0;
  private bayBorn: number[] = [];
  private bayFlash: number[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
  }

  /** Match the backing store to the CSS size and the screen's pixel density. */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Fit the round's field inside a rectangle of the page (CSS pixels), centred. */
  fit(round: Round, rect: Rect): void {
    this.scale = Math.max(0.1, Math.min(rect.w / round.width, rect.h / round.height));
    this.ox = rect.x + (rect.w - round.width * this.scale) / 2;
    this.oy = rect.y + (rect.h - round.height * this.scale) / 2;
  }

  /** Forget all cosmetic state: call when a new round starts. */
  reset(): void {
    this.fx = [];
    this.shake = 0;
    this.bayBorn = [];
    this.bayFlash = [];
  }

  toWorld(clientX: number, clientY: number): Vec {
    const box = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - box.left - this.ox) / this.scale,
      y: (clientY - box.top - this.oy) / this.scale,
    };
  }

  onEvent(e: GameEvent, round: Round, now: number): void {
    if (e.type === "deliver") {
      const bay = round.bays[e.bay];
      const color = tagFor(e.bay).color;
      if (bay) {
        this.fx.push({ kind: "ring", x: bay.x, y: bay.y, t: 0, life: 0.6, from: 9, to: 17, color });
        this.fx.push({ kind: "plus", x: bay.x, y: bay.y - BAY_SIZE / 2 - 2.5, t: 0, life: 0.9, color });
      }
      this.bayFlash[e.bay] = now;
    } else if (e.type === "bay") {
      this.bayBorn[e.bay] = now;
      const bay = round.bays[e.bay];
      if (bay) {
        this.fx.push({ kind: "ring", x: bay.x, y: bay.y, t: 0, life: 1, from: 8, to: 26, color: tagFor(e.bay).color });
      }
    } else if (e.type === "bump") {
      this.shake = 0.6;
      this.fx.push({ kind: "poof", x: e.x, y: e.y, t: 0, life: 0.7, stay: false });
    } else if (e.type === "crash") {
      this.shake = 1;
      this.fx.push({ kind: "poof", x: e.x, y: e.y, t: 0, life: 0.7, stay: true });
    }
  }

  draw(round: Round, now: number, dt: number, ghost: Ghost | null): void {
    const ctx = this.ctx;
    const px = 1 / this.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      const amp = this.shake * this.shake * 9;
      sx = Math.sin(now * 71) * amp;
      sy = Math.cos(now * 93) * amp;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, Math.round((this.ox + sx) * this.dpr), Math.round((this.oy + sy) * this.dpr));

    // The yard: one soft sheet. Everything that moves is clipped to it.
    ctx.beginPath();
    ctx.roundRect(0, 0, round.width, round.height, YARD_RADIUS);
    ctx.fillStyle = YARD;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (const v of round.vehicles) this.drawPath(v);
    if (ghost) this.drawGhostTrail(ghost);
    for (const bay of round.bays) if (bay.open) this.drawBay(round, bay.id, now);
    for (const a of round.arrivals) this.drawArrival(a, now);
    for (const v of round.vehicles) this.drawShadow(v);
    for (const v of round.vehicles) this.drawVehicle(v, px);
    ctx.restore();

    ctx.beginPath();
    ctx.roundRect(0, 0, round.width, round.height, YARD_RADIUS);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5 * px, 0.3);
    ctx.stroke();

    this.drawWarnings(round, now);
    this.drawEffects(dt, px);
    if (ghost) this.drawGhostFinger(ghost, px);
  }

  /* ---------- garages ---------- */

  private drawBay(round: Round, id: number, now: number): void {
    const ctx = this.ctx;
    const bay = round.bays[id]!;
    const tag = tagFor(id);
    const born = this.bayBorn[id];
    const k = born === undefined ? 1 : easeOutBack((now - born) / 0.55);
    const flashAt = this.bayFlash[id];
    const flash = flashAt === undefined ? 0 : Math.max(0, Math.min(1, 1 - (now - flashAt) / 0.5));
    const expected = round.vehicles.some((v) => v.bay === id && v.locked);
    const half = BAY_SIZE / 2;

    ctx.save();
    ctx.translate(bay.x, bay.y);
    ctx.scale(k * (1 + flash * 0.08), k * (1 + flash * 0.08));
    // Soft shadow, then a solid pad in the bay's colour: the same colour as its vehicles.
    ctx.beginPath();
    ctx.roundRect(-half + 0.5, -half + 0.9, BAY_SIZE, BAY_SIZE, 3.4);
    ctx.fillStyle = ink(0.12);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-half, -half, BAY_SIZE, BAY_SIZE, 3.4);
    ctx.fillStyle = tag.color;
    ctx.fill();
    // A lighter floor inside, so a parked vehicle still reads.
    ctx.beginPath();
    ctx.roundRect(-half + 1.3, -half + 1.3, BAY_SIZE - 2.6, BAY_SIZE - 2.6, 2.3);
    ctx.fillStyle = `rgba(255,255,255,${0.16 + (expected ? 0.1 : 0) + flash * 0.4})`;
    ctx.fill();
    traceShape(ctx, tag.shape, 0, 0, 3.3);
    ctx.fillStyle = WHITE;
    ctx.fill();
    ctx.restore();
  }

  /* ---------- drawn lines ---------- */

  private tracePolyline(start: Vec, points: Vec[], from: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    const n = points.length;
    // Curve through the midpoints so a shaky finger still gives a smooth line.
    for (let i = from; i < n - 1; i++) {
      const p = points[i]!;
      const q = points[i + 1]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const last = points[n - 1];
    if (last && from < n) ctx.lineTo(last.x, last.y);
  }

  private drawPath(v: Vehicle): void {
    if (v.next >= v.path.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = tagFor(v.bay).color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.tracePolyline(v, v.path, v.next);
    if (v.locked) {
      // A line that reaches home becomes a soft ribbon of road.
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.lineWidth = 1.25;
      ctx.setLineDash([0.01, 2.9]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ---------- vehicles ---------- */

  /** 1 while driving; falls to 0 as a vehicle rolls into its garage. */
  private parkFade(v: Vehicle): number {
    return v.phase === "parking" ? 1 - ease(v.parkT / PARK_TIME) : 1;
  }

  private drawShadow(v: Vehicle): void {
    const ctx = this.ctx;
    const spec = KINDS[v.kind];
    const fade = this.parkFade(v);
    const k = 0.45 + 0.55 * fade;
    ctx.save();
    ctx.translate(v.x + 0.6, v.y + 0.95);
    ctx.rotate(v.heading);
    ctx.scale(k, k);
    ctx.fillStyle = ink(0.16 * fade);
    ctx.beginPath();
    ctx.roundRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width, spec.width * 0.42);
    ctx.fill();
    ctx.restore();
  }

  private drawVehicle(v: Vehicle, px: number): void {
    const ctx = this.ctx;
    const spec = KINDS[v.kind];
    const tag = tagFor(v.bay);
    const L = spec.length;
    const W = spec.width;
    const fade = this.parkFade(v);
    const k = 0.45 + 0.55 * fade;

    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.heading);
    ctx.scale(k, k);
    ctx.globalAlpha = Math.min(1, fade * 1.6);

    // Tyres, peeking out from under the body.
    ctx.fillStyle = INK;
    const tyreL = L * 0.16;
    const tyreW = W * 0.2;
    const axles = v.kind === "truck" ? [-0.36, -0.2, 0.34] : [-0.27, 0.27];
    for (const a of axles) {
      ctx.beginPath();
      ctx.roundRect(L * a - tyreL / 2, -W / 2 - tyreW * 0.4, tyreL, tyreW, tyreW * 0.3);
      ctx.roundRect(L * a - tyreL / 2, W / 2 - tyreW * 0.6, tyreL, tyreW, tyreW * 0.3);
      ctx.fill();
    }

    const glass = ink(0.82);
    ctx.lineWidth = Math.max(1.25 * px, 0.28);
    ctx.strokeStyle = ink(0.6);
    let tagX = 0;
    let tagR = W * 0.27;
    if (v.kind === "truck") {
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L * 0.7, W, W * 0.16);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(L * 0.2, -W * 0.14, L * 0.06, W * 0.28);
      ctx.beginPath();
      ctx.roundRect(L * 0.245, -W * 0.46, L * 0.255, W * 0.92, W * 0.24);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.375, -W * 0.34, L * 0.075, W * 0.68, W * 0.1);
      ctx.fillStyle = glass;
      ctx.fill();
      tagX = -L * 0.15;
      tagR = W * 0.3;
    } else if (v.kind === "van") {
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.26);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.24, -W * 0.36, L * 0.14, W * 0.72, W * 0.12);
      ctx.fillStyle = glass;
      ctx.fill();
      tagX = -L * 0.13;
      tagR = W * 0.29;
    } else {
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.42);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.14, -W * 0.36, L * 0.17, W * 0.72, W * 0.16);
      ctx.fillStyle = glass;
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-L * 0.39, -W * 0.32, L * 0.09, W * 0.64, W * 0.1);
      ctx.fillStyle = ink(0.6);
      ctx.fill();
      tagX = -L * 0.09;
    }
    // The tag on the roof, in white. It stays upright so it always matches the garage's.
    ctx.save();
    ctx.translate(tagX, 0);
    ctx.rotate(-v.heading);
    traceShape(ctx, tag.shape, 0, 0, tagR);
    ctx.fillStyle = WHITE;
    ctx.fill();
    ctx.restore();
    // Headlights.
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.roundRect(L / 2 - L * 0.04, -W * 0.36, L * 0.03, W * 0.17, L * 0.01);
    ctx.roundRect(L / 2 - L * 0.04, W * 0.19, L * 0.03, W * 0.17, L * 0.01);
    ctx.fill();
    ctx.restore();
  }

  /** One clear "!" between two vehicles that are about to meet. */
  private drawWarnings(round: Round, now: number): void {
    if (round.warnings.length === 0 || round.over) return;
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(now * 13);
    for (const [ia, ib] of round.warnings) {
      const a = round.vehicles.find((v) => v.id === ia);
      const b = round.vehicles.find((v) => v.id === ib);
      if (!a || !b) continue;
      const x = Math.max(5, Math.min(round.width - 5, (a.x + b.x) / 2));
      const y = Math.max(5, Math.min(round.height - 5, (a.y + b.y) / 2));
      const r = 3.3 + pulse * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.roundRect(x - 0.5, y - 2.1, 1, 2.6, 0.4);
      ctx.arc(x, y + 1.55, 0.58, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------- arrivals ---------- */

  /** A chunky arrow in the vehicle's colour, bouncing where it will drive in. */
  private drawArrival(a: Arrival, now: number): void {
    const ctx = this.ctx;
    const tag = tagFor(a.bay);
    const left = Math.max(0, Math.min(1, a.eta / LEAD));
    const appear = easeOutBack((1 - left) * 5);
    const bob = Math.sin(now * 8) * 0.9;
    ctx.save();
    ctx.translate(a.x + Math.cos(a.dir) * (7 + bob), a.y + Math.sin(a.dir) * (7 + bob));
    ctx.rotate(a.dir);
    ctx.scale(appear, appear);
    ctx.beginPath();
    ctx.moveTo(-4.2, -1.5);
    ctx.lineTo(0.2, -1.5);
    ctx.lineTo(0.2, -3.6);
    ctx.lineTo(4.4, 0);
    ctx.lineTo(0.2, 3.6);
    ctx.lineTo(0.2, 1.5);
    ctx.lineTo(-4.2, 1.5);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = tag.color;
    ctx.stroke();
    ctx.fillStyle = tag.color;
    ctx.fill();
    ctx.restore();
  }

  /* ---------- effects ---------- */

  private drawEffects(dt: number, px: number): void {
    const ctx = this.ctx;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i]!;
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1 && !(e.kind === "poof" && e.stay)) {
        this.fx.splice(i, 1);
        continue;
      }
      if (e.kind === "ring") {
        const out = 1 - Math.pow(1 - k, 3);
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(2 * px, 0.45);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.from + (e.to - e.from) * out, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.kind === "plus") {
        const rise = (1 - Math.pow(1 - k, 2)) * 5;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.fillStyle = e.color;
        ctx.font = `700 5px Geist, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("+1", e.x, e.y - rise);
        ctx.globalAlpha = 1;
      } else {
        // A burst of short strokes. After the last crash it stays on the field.
        const kk = Math.min(1, k);
        const out = 1 - Math.pow(1 - kk, 3);
        ctx.globalAlpha = e.stay ? 1 : 1 - kk * kk;
        ctx.strokeStyle = INK;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2.5 * px, 0.6);
        ctx.beginPath();
        for (let s = 0; s < 10; s++) {
          const a = (s / 10) * Math.PI * 2 + 0.3;
          const r0 = 5 + out * 6;
          const r1 = r0 + 2.4 + (s % 2) * 1.6;
          ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
          ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------- the teaching finger ---------- */

  private drawGhostTrail(g: Ghost): void {
    if (g.trail.length < 2) return;
    const ctx = this.ctx;
    ctx.globalAlpha = g.alpha;
    ctx.strokeStyle = g.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([0.01, 2.9]);
    ctx.beginPath();
    ctx.moveTo(g.trail[0]!.x, g.trail[0]!.y);
    for (let i = 1; i < g.trail.length; i++) ctx.lineTo(g.trail[i]!.x, g.trail[i]!.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** A little pointing hand, so it reads as "your finger goes here". */
  private drawGhostFinger(g: Ghost, px: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = g.alpha;
    ctx.translate(g.x, g.y);
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = ink(0.1);
    ctx.fill();
    // Finger and palm, fingertip on the line.
    ctx.beginPath();
    ctx.roundRect(-1.3, -0.6, 2.6, 7, 1.3);
    ctx.roundRect(-1.5, 4.4, 5.6, 5.4, 1.8);
    // Stroke first, fill second: the fill hides the seam where the two shapes meet.
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(3 * px, 0.64);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.fill();
    ctx.restore();
  }
}
