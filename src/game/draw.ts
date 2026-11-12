/** Canvas renderer. Reads a Round and draws it; keeps only cosmetic state (trails, bursts, shake). */
import {
  BAY_HEIGHT,
  BAY_WIDTH,
  KINDS,
  LEAD,
  PARK_TIME,
  type Arrival,
  type GameEvent,
  type Round,
  type Vec,
  type Vehicle,
} from "../engine";
import { INK, ink, PAPER, tagFor, traceShape, YARD } from "./palette";

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

interface Trail {
  left: Vec[];
  right: Vec[];
  /** Seconds since its vehicle left; trails fade once this is above zero. */
  gone: number;
}

type Effect =
  | { kind: "ring"; x: number; y: number; t: number; life: number; from: number; to: number; color: string }
  | { kind: "plus"; x: number; y: number; t: number; life: number; color: string }
  | { kind: "burst"; x: number; y: number; t: number; life: number };

const TRAIL_POINTS = 26;

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
  private cssW = 0;
  private cssH = 0;
  scale = 1;
  private ox = 0;
  private oy = 0;
  private trails = new Map<number, Trail>();
  private fx: Effect[] = [];
  private shake = 0;
  private bayBorn: number[] = [];
  private bayFlash: number[] = [];
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
  }

  /** Match the backing store to the CSS size and the screen's pixel density. */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    const w = Math.max(1, Math.round(this.cssW * this.dpr));
    const h = Math.max(1, Math.round(this.cssH * this.dpr));
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
    this.trails.clear();
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
        this.fx.push({ kind: "ring", x: bay.x, y: bay.y, t: 0, life: 0.6, from: 7, to: 15, color });
        this.fx.push({ kind: "plus", x: bay.x, y: bay.y - BAY_HEIGHT / 2 - 2, t: 0, life: 0.9, color });
      }
      this.bayFlash[e.bay] = now;
    } else if (e.type === "bay") {
      this.bayBorn[e.bay] = now;
      const bay = round.bays[e.bay];
      if (bay) {
        this.fx.push({ kind: "ring", x: bay.x, y: bay.y, t: 0, life: 0.9, from: 6, to: 22, color: tagFor(e.bay).color });
      }
    } else if (e.type === "crash") {
      this.shake = 1;
      this.fx.push({ kind: "burst", x: e.x, y: e.y, t: 0, life: 0.7 });
    }
  }

  draw(round: Round, now: number, dt: number, ghost: Ghost | null): void {
    const ctx = this.ctx;
    const px = 1 / this.scale;
    this.frame++;

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

    this.drawYard(round, px);
    for (const bay of round.bays) if (bay.open) this.drawBay(round, bay.id, now, px);
    this.updateTrails(round, dt);
    this.drawTrails(px);
    for (const v of round.vehicles) this.drawPath(v, px);
    if (ghost) this.drawGhostTrail(ghost);
    for (const v of round.vehicles) this.drawShadow(v);
    for (const v of round.vehicles) this.drawVehicle(v, px);
    this.drawWarnings(round, now, px);
    for (const a of round.arrivals) this.drawArrival(a, now, px);
    this.drawEffects(dt, px);
    if (ghost) this.drawGhostFinger(ghost, px);
  }

  /* ---------- the yard and its bays ---------- */

  private drawYard(round: Round, px: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = YARD;
    ctx.fillRect(0, 0, round.width, round.height);
    // A quiet dot grid, like squared paper.
    ctx.fillStyle = ink(0.13);
    const gap = 10;
    const dot = Math.max(px, 0.16);
    const nx = Math.floor(round.width / gap);
    const ny = Math.floor(round.height / gap);
    const x0 = (round.width - nx * gap) / 2;
    const y0 = (round.height - ny * gap) / 2;
    for (let i = 1; i < nx + (x0 > 1 ? 1 : 0); i++) {
      for (let j = 1; j < ny + (y0 > 1 ? 1 : 0); j++) {
        ctx.fillRect(x0 + i * gap - dot / 2, y0 + j * gap - dot / 2, dot, dot);
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = px;
    ctx.strokeRect(0, 0, round.width, round.height);
  }

  private drawBay(round: Round, id: number, now: number, px: number): void {
    const ctx = this.ctx;
    const bay = round.bays[id]!;
    const tag = tagFor(id);
    const born = this.bayBorn[id];
    const k = born === undefined ? 1 : easeOutBack((now - born) / 0.5);
    const flashAt = this.bayFlash[id];
    const flash = flashAt === undefined ? 0 : Math.max(0, 1 - (now - flashAt) / 0.7);
    const expected = round.vehicles.some((v) => v.bay === id && v.locked);

    ctx.save();
    ctx.translate(bay.x, bay.y);
    ctx.scale(k, k);
    const w = BAY_WIDTH;
    const h = BAY_HEIGHT;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 1.6);
    ctx.fillStyle = YARD;
    ctx.fill();
    ctx.globalAlpha = 0.1 + (expected ? 0.1 : 0) + flash * 0.3;
    ctx.fillStyle = tag.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tag.color;
    ctx.lineWidth = Math.max(1.5 * px, 0.34);
    ctx.setLineDash(expected ? [] : [1.9, 1.3]);
    ctx.stroke();
    ctx.setLineDash([]);
    traceShape(ctx, tag.shape, 0, 0, 2.7);
    ctx.fillStyle = tag.color;
    ctx.fill();
    ctx.restore();
  }

  /* ---------- tyre trails ---------- */

  private updateTrails(round: Round, dt: number): void {
    const sample = this.frame % 3 === 0;
    const seen = new Set<number>();
    for (const v of round.vehicles) {
      if (v.phase === "parking") continue;
      seen.add(v.id);
      if (!sample || round.over) continue;
      let trail = this.trails.get(v.id);
      if (!trail) {
        trail = { left: [], right: [], gone: 0 };
        this.trails.set(v.id, trail);
      }
      const spec = KINDS[v.kind];
      const bx = v.x - Math.cos(v.heading) * spec.length * 0.3;
      const by = v.y - Math.sin(v.heading) * spec.length * 0.3;
      const nx = -Math.sin(v.heading) * spec.width * 0.36;
      const ny = Math.cos(v.heading) * spec.width * 0.36;
      trail.left.push({ x: bx + nx, y: by + ny });
      trail.right.push({ x: bx - nx, y: by - ny });
      if (trail.left.length > TRAIL_POINTS) {
        trail.left.shift();
        trail.right.shift();
      }
    }
    for (const [id, trail] of this.trails) {
      if (seen.has(id)) continue;
      trail.gone += dt;
      if (trail.gone > 0.8) this.trails.delete(id);
    }
  }

  private drawTrails(px: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(px, 0.5);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const trail of this.trails.values()) {
      const fade = 1 - Math.min(1, trail.gone / 0.8);
      for (const side of [trail.left, trail.right]) {
        const n = side.length;
        // Three bands, faintest at the tail.
        for (let band = 0; band < 3; band++) {
          const from = Math.floor((n * band) / 3);
          const to = Math.min(n - 1, Math.floor((n * (band + 1)) / 3));
          if (to - from < 1) continue;
          ctx.strokeStyle = ink((0.03 + band * 0.035) * fade);
          ctx.beginPath();
          ctx.moveTo(side[from]!.x, side[from]!.y);
          for (let i = from + 1; i <= to; i++) ctx.lineTo(side[i]!.x, side[i]!.y);
          ctx.stroke();
        }
      }
    }
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

  private drawPath(v: Vehicle, px: number): void {
    if (v.next >= v.path.length) return;
    const ctx = this.ctx;
    const tag = tagFor(v.bay);
    ctx.strokeStyle = tag.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.tracePolyline(v, v.path, v.next);
    if (v.locked) {
      ctx.lineWidth = Math.max(2 * px, 0.45);
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.lineWidth = Math.max(3 * px, 0.85);
      ctx.setLineDash([0.01, 2.3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const end = v.path[v.path.length - 1]!;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 1.3, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5 * px, 0.3);
      ctx.stroke();
    }
  }

  /* ---------- vehicles ---------- */

  private parkFade(v: Vehicle): number {
    return v.phase === "parking" ? 1 - ease((v.parkT - PARK_TIME * 0.35) / (PARK_TIME * 0.65)) : 1;
  }

  private drawShadow(v: Vehicle): void {
    const ctx = this.ctx;
    const spec = KINDS[v.kind];
    const fade = this.parkFade(v);
    ctx.save();
    ctx.translate(v.x + 0.5, v.y + 0.75);
    ctx.rotate(v.heading);
    const L = spec.length;
    const W = spec.width;
    ctx.fillStyle = ink(0.07 * fade);
    ctx.beginPath();
    ctx.roundRect(-L / 2 - 0.5, -W / 2 - 0.5, L + 1, W + 1, W * 0.45);
    ctx.fill();
    ctx.fillStyle = ink(0.13 * fade);
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.4);
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
    const line = Math.max(px, 0.2);

    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.heading);
    if (v.phase === "parking") {
      const k = 1 - 0.1 * ease(v.parkT / PARK_TIME);
      ctx.scale(k, k);
    }
    ctx.globalAlpha = fade;

    // Tyres, peeking out from under the body.
    ctx.fillStyle = INK;
    const tyreL = L * 0.15;
    const tyreW = W * 0.16;
    const axles = v.kind === "truck" ? [-0.36, -0.22, 0.33] : [-0.28, 0.27];
    for (const a of axles) {
      ctx.fillRect(L * a - tyreL / 2, -W / 2 - tyreW * 0.45, tyreL, tyreW);
      ctx.fillRect(L * a - tyreL / 2, W / 2 - tyreW * 0.55, tyreL, tyreW);
    }

    const outline = ink(0.5);
    ctx.lineWidth = line;
    if (v.kind === "truck") {
      // Trailer.
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L * 0.7, W, W * 0.1);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath();
      for (const rib of [-0.4, 0.1]) {
        ctx.moveTo(L * rib, -W * 0.38);
        ctx.lineTo(L * rib, W * 0.38);
      }
      ctx.stroke();
      // Coupling and cab.
      ctx.fillStyle = INK;
      ctx.fillRect(L * 0.2, -W * 0.14, L * 0.06, W * 0.28);
      ctx.beginPath();
      ctx.roundRect(L * 0.245, -W * 0.47, L * 0.255, W * 0.94, W * 0.2);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.fillStyle = ink(0.22);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.385, -W * 0.37, L * 0.065, W * 0.74, W * 0.08);
      ctx.fillStyle = ink(0.78);
      ctx.fill();
      traceShape(ctx, tag.shape, -L * 0.15, 0, W * 0.3);
    } else if (v.kind === "van") {
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.22);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.25, -W * 0.38, L * 0.13, W * 0.76, W * 0.1);
      ctx.fillStyle = ink(0.78);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-L * 0.44, -W * 0.37, L * 0.63, W * 0.74, W * 0.12);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.stroke();
      traceShape(ctx, tag.shape, -L * 0.13, 0, W * 0.28);
    } else {
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.4);
      ctx.fillStyle = tag.color;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(L * 0.13, -W * 0.37, L * 0.17, W * 0.74, W * 0.14);
      ctx.fillStyle = ink(0.78);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-L * 0.38, -W * 0.34, L * 0.09, W * 0.68, W * 0.1);
      ctx.fillStyle = ink(0.55);
      ctx.fill();
      traceShape(ctx, tag.shape, -L * 0.09, 0, W * 0.27);
    }
    // The tag on the roof, in paper white.
    ctx.fillStyle = "#fbf8f1";
    ctx.fill();
    // Headlights.
    ctx.fillStyle = "#fbf8f1";
    ctx.fillRect(L / 2 - L * 0.035, -W * 0.36, L * 0.03, W * 0.16);
    ctx.fillRect(L / 2 - L * 0.035, W * 0.2, L * 0.03, W * 0.16);
    ctx.restore();
  }

  private drawWarnings(round: Round, now: number, px: number): void {
    if (round.warnings.length === 0) return;
    const ctx = this.ctx;
    const ids = new Set<number>();
    for (const [a, b] of round.warnings) {
      ids.add(a);
      ids.add(b);
    }
    const pulse = round.over ? 1 : 0.5 + 0.5 * Math.sin(now * 14);
    ctx.strokeStyle = ink(0.45 + 0.5 * pulse);
    ctx.lineWidth = Math.max(2 * px, 0.4);
    for (const v of round.vehicles) {
      if (!ids.has(v.id)) continue;
      const r = KINDS[v.kind].length * 0.62 + 1.2 + pulse * 0.8;
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ---------- arrivals ---------- */

  private drawArrival(a: Arrival, now: number, px: number): void {
    const ctx = this.ctx;
    const tag = tagFor(a.bay);
    const left = Math.max(0, Math.min(1, a.eta / LEAD));
    const appear = ease((1 - left) * 8);
    const cx = Math.cos(a.dir);
    const cy = Math.sin(a.dir);
    const width = KINDS[a.kind].width;
    const bob = Math.sin(now * 7) * 0.5;

    ctx.save();
    ctx.globalAlpha = appear;
    // A coloured bar on the edge marks the gate it will come through.
    ctx.strokeStyle = tag.color;
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(4 * px, 0.9);
    ctx.beginPath();
    ctx.moveTo(a.x + cy * (width / 2 + 1), a.y - cx * (width / 2 + 1));
    ctx.lineTo(a.x - cy * (width / 2 + 1), a.y + cx * (width / 2 + 1));
    ctx.stroke();

    // The badge: which bay it is for, with a ring that runs down.
    const bx = a.x + cx * 6.2;
    const by = a.y + cy * 6.2;
    ctx.beginPath();
    ctx.arc(bx, by, 3.3, 0, Math.PI * 2);
    ctx.fillStyle = YARD;
    ctx.fill();
    ctx.strokeStyle = ink(0.16);
    ctx.lineWidth = Math.max(px, 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(bx, by, 3.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.strokeStyle = tag.color;
    ctx.lineWidth = Math.max(2 * px, 0.45);
    ctx.stroke();
    traceShape(ctx, tag.shape, bx, by, 1.55);
    ctx.fillStyle = tag.color;
    ctx.fill();

    // An arrow pointing the way it will drive.
    const ax = a.x + cx * (11.2 + bob);
    const ay = a.y + cy * (11.2 + bob);
    ctx.beginPath();
    ctx.moveTo(ax + cx * 1.6, ay + cy * 1.6);
    ctx.lineTo(ax - cx * 0.9 + cy * 1.5, ay - cy * 0.9 - cx * 1.5);
    ctx.lineTo(ax - cx * 0.9 - cy * 1.5, ay - cy * 0.9 + cx * 1.5);
    ctx.closePath();
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
      if (k >= 1 && e.kind !== "burst") {
        this.fx.splice(i, 1);
        continue;
      }
      if (e.kind === "ring") {
        const out = 1 - Math.pow(1 - k, 3);
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(1.5 * px, 0.3);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.from + (e.to - e.from) * out, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.kind === "plus") {
        const rise = (1 - Math.pow(1 - k, 2)) * 5;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.fillStyle = e.color;
        ctx.font = `600 ${4.2}px Geist, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("+1", e.x, e.y - rise);
        ctx.globalAlpha = 1;
      } else {
        // The crash mark stays on the field after the burst has played out.
        const kk = Math.min(1, k);
        const out = 1 - Math.pow(1 - kk, 3);
        ctx.strokeStyle = INK;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(2 * px, 0.45);
        ctx.beginPath();
        for (let s = 0; s < 12; s++) {
          const a = (s / 12) * Math.PI * 2 + 0.2;
          const r0 = 6 + out * 4 + (s % 2) * 1.5;
          const r1 = r0 + 2.5 + (s % 3) * 1.2 * out;
          ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
          ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
        }
        ctx.stroke();
        if (kk < 1) {
          ctx.globalAlpha = (1 - kk) * 0.7;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 4 + out * 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
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
    ctx.lineWidth = Math.max(3 / this.scale, 0.85);
    ctx.setLineDash([0.01, 2.3]);
    ctx.beginPath();
    ctx.moveTo(g.trail[0]!.x, g.trail[0]!.y);
    for (let i = 1; i < g.trail.length; i++) ctx.lineTo(g.trail[i]!.x, g.trail[i]!.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawGhostFinger(g: Ghost, px: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = g.alpha;
    ctx.beginPath();
    ctx.arc(g.x, g.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = ink(0.14);
    ctx.fill();
    ctx.strokeStyle = ink(0.75);
    ctx.lineWidth = Math.max(1.5 * px, 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(g.x, g.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = ink(0.75);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
