import type { TrackInfo, TrackedBox } from "./types";

// Greedy IoU tracker with constant-velocity prediction. Good enough for 5 s segments at 30 fps:
// links per-frame YOLO boxes into objects with stable, speakable ids ("truck 2").

export type Box = [number, number, number, number]; // x1, y1, x2, y2 as 0–1 fractions
export type Det = { label: string; conf: number; box: Box };

const MATCH_IOU = 0.2;
const MAX_GAP = 10; // frames an object may go undetected and keep its id
const MIN_FRAMES = 5; // shorter tracks are flicker

const center = (b: Box) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as const;
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

function iou(a: Box, b: Box) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (area(a) + area(b) - inter);
}

/** Overlap score, falling back to centre distance for small, fast boxes that barely overlap. */
function score(pred: Box, d: Box) {
  const o = iou(pred, d);
  if (o >= MATCH_IOU) return o;
  const [px, py] = center(pred);
  const [dx, dy] = center(d);
  const size = Math.max(pred[2] - pred[0], pred[3] - pred[1], d[2] - d[0], d[3] - d[1]);
  const dist = Math.hypot(px - dx, py - dy);
  return dist < size * 0.5 ? 0.1 * (1 - dist / (size * 0.5)) + 0.01 : 0;
}

function motion(first: Box, last: Box, aspect: number) {
  const [x0, y0] = center(first);
  const [x1, y1] = center(last);
  const dx = (x1 - x0) * aspect;
  const dy = y1 - y0;
  const parts: string[] = [];
  if (Math.hypot(dx, dy) < 0.05) parts.push("mostly stationary");
  else if (Math.abs(dx) >= Math.abs(dy)) parts.push(dx > 0 ? "moves left to right" : "moves right to left");
  else parts.push(dy > 0 ? "moves down the frame" : "moves up the frame");
  const grow = area(last) / Math.max(area(first), 1e-6);
  if (grow > 1.5) parts.push("approaching the camera");
  else if (grow < 0.67) parts.push("moving away from the camera");
  return parts.join(", ");
}

type Live = {
  label: string;
  first: number;
  last: number;
  box: Box;
  firstBox: Box;
  vel: [number, number];
  hits: { f: number; d: Det }[];
};

export function trackFrames(frames: Det[][], times: number[], aspect: number) {
  const all: Live[] = [];
  let active: Live[] = [];

  frames.forEach((dets, f) => {
    active = active.filter((t) => f - t.last <= MAX_GAP);
    const pairs: [number, Live, number][] = [];
    for (const t of active) {
      const gap = f - t.last;
      const pred: Box = [t.box[0] + t.vel[0] * gap, t.box[1] + t.vel[1] * gap, t.box[2] + t.vel[0] * gap, t.box[3] + t.vel[1] * gap];
      dets.forEach((d, i) => {
        if (d.label !== t.label) return;
        const s = score(pred, d.box);
        if (s > 0) pairs.push([s, t, i]);
      });
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedT = new Set<Live>();
    const usedD = new Set<number>();
    for (const [, t, i] of pairs) {
      if (usedT.has(t) || usedD.has(i)) continue;
      usedT.add(t);
      usedD.add(i);
      const d = dets[i];
      const gap = f - t.last;
      const [cx, cy] = center(t.box);
      const [nx, ny] = center(d.box);
      t.vel = [0.5 * t.vel[0] + (0.5 * (nx - cx)) / gap, 0.5 * t.vel[1] + (0.5 * (ny - cy)) / gap];
      t.box = d.box;
      t.last = f;
      t.hits.push({ f, d });
    }
    dets.forEach((d, i) => {
      if (usedD.has(i)) return;
      const t: Live = { label: d.label, first: f, last: f, box: d.box, firstBox: d.box, vel: [0, 0], hits: [{ f, d }] };
      all.push(t);
      active.push(t);
    });
  });

  const kept = all.filter((t) => t.hits.length >= MIN_FRAMES).sort((a, b) => a.first - b.first);
  const perLabel: Record<string, number> = {};
  const tracks: TrackInfo[] = kept.map((t) => {
    perLabel[t.label] = (perLabel[t.label] || 0) + 1;
    const conf = t.hits.reduce((s, h) => s + h.d.conf, 0) / t.hits.length;
    return {
      id: `${t.label} ${perLabel[t.label]}`,
      label: t.label,
      start: round(times[t.first], 2),
      end: round(times[t.last], 2),
      frames: t.hits.length,
      conf: round(conf, 2),
      motion: motion(t.firstBox, t.box, aspect),
    };
  });

  const out: TrackedBox[][] = frames.map(() => []);
  kept.forEach((t, ti) => {
    for (const { f, d } of t.hits) out[f].push([ti, ...d.box.map((v) => round(v, 4)), round(d.conf, 2)] as TrackedBox);
  });

  const counts: Record<string, number> = {};
  for (const boxes of out) {
    const local: Record<string, number> = {};
    for (const b of boxes) local[tracks[b[0]].label] = (local[tracks[b[0]].label] || 0) + 1;
    for (const [l, n] of Object.entries(local)) counts[l] = Math.max(counts[l] || 0, n);
  }
  return { tracks, frames: out, counts, unique: perLabel };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
