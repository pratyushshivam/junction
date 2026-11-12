import {
  beginPath,
  createRound,
  dailySeed,
  endPath,
  extendPath,
  KINDS,
  step,
  STEP,
  type GameEvent,
  type Round,
} from "./engine";
import { Sound } from "./game/audio";
import { Renderer, type Ghost, type Rect } from "./game/draw";
import { Autopilot, Teacher } from "./game/ghost";
import { copyText, dateKey, dateLabel, shareText, type RoundKind } from "./game/share";
import { load, loadNumber, save } from "./game/storage";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>("field");
const fieldSlot = el("field-slot");
const demoSlot = el("demo-slot");
const hud = el("hud");
const scoreEl = el("score");
const modeEl = el("mode");
const muteBtn = el<HTMLButtonElement>("mute");
const hintEl = el("hint");
const startEl = el("start");
const cardEl = el("card");
const shareBtn = el<HTMLButtonElement>("share");
const switchBtn = el<HTMLButtonElement>("switch");

const renderer = new Renderer(canvas);
const sound = new Sound();
const teacher = new Teacher();
const autopilot = new Autopilot();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Mode = "start" | "play" | "crash" | "over";
let mode: Mode = "start";
let kind: RoundKind = "daily";
let today = new Date();
let round: Round = createRound(1, 1);
let best = loadNumber("best");
/** Until the player has delivered one vehicle, ever, the first round teaches. */
let teaching = load("taught") !== "1";
let crashAt = 0;
let hintUntil = 0;
let last = 0;
let acc = 0;
/** Which vehicle each finger (or the mouse) is drawing for. */
const fingers = new Map<number, number>();

/* ---------- layout ---------- */

function slotRect(slot: HTMLElement): Rect {
  const b = slot.getBoundingClientRect();
  return { x: b.left, y: b.top, w: Math.max(40, b.width), h: Math.max(40, b.height) };
}

function activeRect(): Rect {
  return slotRect(mode === "start" ? demoSlot : fieldSlot);
}

function refit(): void {
  renderer.resize();
  renderer.fit(round, activeRect());
}

/* ---------- rounds ---------- */

function startDemo(): void {
  mode = "start";
  const rect = slotRect(demoSlot);
  round = createRound(20261113, rect.w / rect.h, { calm: true, collide: false });
  autopilot.reset();
  renderer.reset();
  renderer.fit(round, rect);
}

function startRound(next: RoundKind): void {
  kind = next;
  today = new Date();
  startEl.hidden = true;
  cardEl.hidden = true;
  hud.hidden = false;
  mode = "play";
  const rect = slotRect(fieldSlot);
  const seed = kind === "daily" ? dailySeed(dateKey(today)) : (Math.random() * 0xffffffff) >>> 0;
  round = createRound(seed, rect.w / rect.h, { calm: teaching });
  fingers.clear();
  renderer.reset();
  renderer.fit(round, rect);
  acc = 0;
  scoreEl.textContent = "0";
  modeEl.textContent = kind === "daily" ? `Today · ${dateLabel(today).replace(/ \d{4}$/, "")}` : "Free play";
  shareBtn.textContent = "Share";
  showHint(teaching ? "Drag from the car to its matching bay" : "", Infinity);
}

function showHint(text: string, seconds: number): void {
  hintEl.hidden = text === "";
  hintEl.textContent = text;
  hintUntil = seconds === Infinity ? Infinity : last + seconds;
}

function showCard(): void {
  mode = "over";
  const score = round.score;
  const isBest = score > best;
  if (isBest) {
    best = score;
    save("best", String(best));
  }
  el("card-kicker").textContent =
    kind === "daily" ? `Today’s round · ${dateLabel(today)}` : "Free play · a random round";
  el("card-score").textContent = String(score);
  el("card-unit").textContent = score === 1 ? "vehicle delivered" : "vehicles delivered";
  el("card-best").textContent = `Best ${best}`;
  el("card-new").hidden = !isBest || score === 0;
  switchBtn.textContent = kind === "daily" ? "Try a random round" : "Play today’s round";
  hintEl.hidden = true;
  cardEl.hidden = false;
  el<HTMLButtonElement>("again").focus({ preventScroll: true });
}

function onEvent(e: GameEvent, now: number): void {
  renderer.onEvent(e, round, now);
  if (mode === "start") return;
  if (e.type === "announce") {
    sound.arrival();
  } else if (e.type === "deliver") {
    sound.chime(e.bay);
    scoreEl.textContent = String(round.score);
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("bump");
    if (teaching) {
      teaching = false;
      save("taught", "1");
      round.calm = false;
      // Do not leave the yard empty for long after the lesson.
      round.untilAnnounce = Math.min(round.untilAnnounce, 1.2);
      showHint("Now keep them apart: two touching ends the round", 5);
    }
  } else if (e.type === "bay") {
    sound.newBay();
  } else if (e.type === "crash") {
    sound.crash();
    mode = "crash";
    crashAt = now;
    fingers.clear();
  }
}

/* ---------- drawing with a finger or the mouse ---------- */

function pick(x: number, y: number): number {
  const reach = Math.max(10, 38 / renderer.scale);
  let bestId = -1;
  let bestGap = Infinity;
  for (const v of round.vehicles) {
    if (v.phase === "parking") continue;
    const d = Math.hypot(v.x - x, v.y - y);
    const gap = d - KINDS[v.kind].length / 2;
    if (gap < reach && d < bestGap) {
      bestGap = d;
      bestId = v.id;
    }
  }
  return bestId;
}

canvas.addEventListener("pointerdown", (e) => {
  sound.unlock();
  if (mode !== "play") return;
  e.preventDefault();
  const p = renderer.toWorld(e.clientX, e.clientY);
  const id = pick(p.x, p.y);
  if (id < 0 || !beginPath(round, id)) return;
  // One finger per vehicle: a second finger on the same one takes over.
  for (const [finger, vehicle] of fingers) if (vehicle === id) fingers.delete(finger);
  fingers.set(e.pointerId, id);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* the pointer is already gone */
  }
  sound.pick();
});

canvas.addEventListener("pointermove", (e) => {
  const id = fingers.get(e.pointerId);
  if (id === undefined || mode !== "play") return;
  const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  for (const ev of events.length > 0 ? events : [e]) {
    const result = extendPath(round, id, renderer.toWorld(ev.clientX, ev.clientY));
    if (result === "added") sound.tick();
    if (result === "locked") {
      const v = round.vehicles.find((c) => c.id === id);
      sound.lock(v ? v.bay : 0);
      fingers.delete(e.pointerId);
      break;
    }
  }
});

function lift(e: PointerEvent): void {
  const id = fingers.get(e.pointerId);
  if (id === undefined) return;
  fingers.delete(e.pointerId);
  endPath(round, id);
}
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- buttons ---------- */

function syncMute(): void {
  muteBtn.setAttribute("aria-pressed", String(sound.muted));
  muteBtn.setAttribute("aria-label", sound.muted ? "Turn sound on" : "Mute sound");
}

muteBtn.addEventListener("click", () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  syncMute();
});

function play(next: RoundKind): void {
  sound.unlock();
  startRound(next);
}

el("play-daily").addEventListener("click", () => play("daily"));
el("play-free").addEventListener("click", () => play("free"));
el("again").addEventListener("click", () => play(kind));
switchBtn.addEventListener("click", () => play(kind === "daily" ? "free" : "daily"));

shareBtn.addEventListener("click", () => {
  const url = location.protocol.startsWith("http") ? location.origin + location.pathname : "";
  void copyText(shareText(round.score, kind, today, url)).then((ok) => {
    shareBtn.textContent = ok ? "Copied" : "Copy failed";
    window.setTimeout(() => (shareBtn.textContent = "Share"), 1800);
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") muteBtn.click();
  if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
    if (mode === "start") play("daily");
    else if (mode === "over") play(kind);
  }
});

/* ---------- the loop ---------- */

function tick(now: number, dt: number, paint = true): void {
  let ghost: Ghost | null = null;
  if (mode === "start") ghost = autopilot.update(dt, round);
  else if (mode === "play" && teaching) ghost = teacher.update(dt, round);

  if (mode === "start" || mode === "play") {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      step(round);
      acc -= STEP;
      steps++;
      if (round.events.length > 0) {
        const events = round.events.splice(0);
        for (const e of events) onEvent(e, now);
      }
    }
    if (steps === 6) acc = 0;
  }
  // The demo never ends; start it over before the yard gets too busy to read.
  if (mode === "start" && round.score >= 9 && round.vehicles.length === 0) startDemo();
  if (mode === "crash" && now - crashAt > (reducedMotion ? 0.5 : 1.05)) showCard();
  if (!hintEl.hidden && now > hintUntil) hintEl.hidden = true;

  if (paint) renderer.draw(round, now, reducedMotion && mode === "crash" ? 1 : dt, ghost);
}

function frame(ms: number): void {
  const now = ms / 1000;
  const dt = Math.min(0.1, Math.max(0, now - last));
  last = now;
  if (!manual) tick(now, dt);
  requestAnimationFrame(frame);
}

/** Development only: drive the clock by hand, for testing in a background tab. */
let manual = false;
function advance(seconds: number): void {
  manual = true;
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    last += STEP;
    tick(last, STEP, i >= frames - 40);
  }
}

/* ---------- boot ---------- */

function boot(): void {
  syncMute();
  el("today").textContent = dateLabel(today);
  el("start-best").textContent = best > 0 ? `Best ${best}` : "";
  renderer.resize();
  startDemo();
  let pending = 0;
  window.addEventListener("resize", () => {
    refit();
    // The demo has no player to upset, so rebuild it to suit the new shape.
    if (mode === "start") {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => mode === "start" && startDemo(), 150);
    }
  });
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __junction: { round: () => round, renderer, mode: () => mode, advance },
    });
  }
  requestAnimationFrame((ms) => {
    last = ms / 1000;
    requestAnimationFrame(frame);
  });
}

boot();
