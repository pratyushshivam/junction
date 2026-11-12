/** Colours and tag shapes. Every bay has both, so the game never relies on colour alone. */

export const PAPER = "#f2eee5";
export const YARD = "#f9f6ef";
export const INK = "#15140f";
export const WHITE = "#fffdf8";

export type Shape = "circle" | "square" | "triangle" | "diamond" | "plus";

export interface Tag {
  color: string;
  shape: Shape;
  name: string;
}

export const TAGS: readonly Tag[] = [
  { color: "#d4491a", shape: "circle", name: "orange circle" },
  { color: "#2a5c8f", shape: "square", name: "blue square" },
  { color: "#3c7a52", shape: "triangle", name: "green triangle" },
  { color: "#c9930f", shape: "diamond", name: "ochre diamond" },
  { color: "#7a4a86", shape: "plus", name: "plum plus" },
];

export function tagFor(bay: number): Tag {
  return TAGS[bay % TAGS.length]!;
}

export function ink(alpha: number): string {
  return `rgba(21,20,15,${alpha})`;
}

/** Trace a tag shape centred on (x, y) with "radius" r. The caller fills or strokes. */
export function traceShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === "square") {
    const s = r * 0.86;
    ctx.rect(x - s, y - s, s * 2, s * 2);
  } else if (shape === "triangle") {
    const s = r * 1.12;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.92, y + s * 0.7);
    ctx.lineTo(x - s * 0.92, y + s * 0.7);
    ctx.closePath();
  } else if (shape === "diamond") {
    const s = r * 1.16;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.82, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.82, y);
    ctx.closePath();
  } else {
    const s = r * 1.05;
    const t = r * 0.36;
    ctx.moveTo(x - t, y - s);
    ctx.lineTo(x + t, y - s);
    ctx.lineTo(x + t, y - t);
    ctx.lineTo(x + s, y - t);
    ctx.lineTo(x + s, y + t);
    ctx.lineTo(x + t, y + t);
    ctx.lineTo(x + t, y + s);
    ctx.lineTo(x - t, y + s);
    ctx.lineTo(x - t, y + t);
    ctx.lineTo(x - s, y + t);
    ctx.lineTo(x - s, y - t);
    ctx.lineTo(x - t, y - t);
    ctx.closePath();
  }
}
