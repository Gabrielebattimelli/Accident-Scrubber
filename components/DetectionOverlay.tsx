"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Detections, TrackedBox } from "@/lib/types";
import type { Note } from "./store";

// Box look from Sightline: corner brackets over a faint fill, people in signal orange, machines in
// white, everything else in stone. Track ids, the focus trail and agent notes are drawn on top.

export const ACCENT = "#ff5a1f";
const MACHINES = new Set(["truck", "car", "bus", "motorcycle", "bicycle", "train", "forklift", "agv", "pallet jack", "humanoid robot", "robot"]);

export function colorFor(label: string) {
  return label === "person" ? ACCENT : MACHINES.has(label) ? "#ffffff" : "#cfcac0";
}

/** Index of the last sampled frame at or before `t` (seconds). */
export function frameAt(times: number[], t: number) {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || t < times[0]) return hi < 0 ? -1 : 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The box of track `id` at time t, or the nearest one within half a second. */
export function boxOf(data: Detections, id: string, t: number): TrackedBox | undefined {
  const ti = data.tracks.findIndex((x) => x.id === id);
  if (ti < 0) return undefined;
  const i = frameAt(data.times, t);
  for (let d = 0; d < 15; d++) {
    const b = data.frames[i - d]?.find((x) => x[0] === ti) || data.frames[i + d]?.find((x) => x[0] === ti);
    if (b) return b;
  }
  return undefined;
}

/** Where the object-contain picture sits inside a W×H box. */
export function pictureRect(v: HTMLVideoElement, W: number, H: number, aspect = 16 / 9) {
  const vw = v.videoWidth || aspect;
  const vh = v.videoHeight || 1;
  const s = Math.min(W / vw, H / vh);
  const cw = vw * s;
  const ch = vh * s;
  return { ox: (W - cw) / 2, oy: (H - ch) / 2, cw, ch };
}

const TRAIL_FRAMES = 60;

/** Draws tracked boxes and agent notes over a playing <video>, following its currentTime. */
export function DetectionOverlay({
  video,
  data,
  boxes = true,
  labels,
  focus,
  notes = [],
}: {
  video: RefObject<HTMLVideoElement | null>;
  data?: Detections;
  boxes?: boolean;
  labels: string[]; // empty = every class
  focus?: string; // track id to highlight
  notes?: Note[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ data, boxes, labels, focus, notes });
  useEffect(() => {
    latest.current = { data, boxes, labels, focus, notes };
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const family = getComputedStyle(el).fontFamily || "ui-monospace, monospace";
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = video.current;
      if (!v) return;
      const { data, boxes, labels, focus: focusId, notes } = latest.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const { ox, oy, cw, ch } = pictureRect(v, W, H, data?.aspect);
      const t = v.currentTime;

      if (data && boxes) {
        const i = frameAt(data.times, t);
        const focus = focusId ? data.tracks.findIndex((x) => x.id === focusId) : -1;
        const visible = (ti: number) =>
          ti === focus || !labels.length || labels.some((l) => data.tracks[ti].label === l || data.tracks[ti].label.includes(l));

        if (i >= 0 && focus >= 0) {
          ctx.beginPath();
          let started = false;
          for (let j = Math.max(0, i - TRAIL_FRAMES); j <= i; j++) {
            const b = data.frames[j]?.find((x) => x[0] === focus);
            if (!b) continue;
            const x = ox + ((b[1] + b[3]) / 2) * cw;
            const y = oy + ((b[2] + b[4]) / 2) * ch;
            if (started) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            started = true;
          }
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.font = `600 10px ${family}`;
        ctx.textBaseline = "alphabetic";
        for (const [ti, x1, y1, x2, y2, conf] of i >= 0 ? data.frames[i] || [] : []) {
          if (conf < 0.35 || !visible(ti)) continue;
          const track = data.tracks[ti];
          const focused = ti === focus;
          const dim = focus >= 0 && !focused;
          const col = colorFor(track.label);
          const L = ox + x1 * cw;
          const T = oy + y1 * ch;
          const R = ox + x2 * cw;
          const B = oy + y2 * ch;
          const k = Math.min(14, (R - L) / 3, (B - T) / 3);
          ctx.globalAlpha = dim ? 0.3 : 1;
          ctx.fillStyle = `${col}1a`;
          ctx.fillRect(L, T, R - L, B - T);
          ctx.strokeStyle = col;
          ctx.lineWidth = focused ? 2.5 : 2;
          ctx.beginPath();
          if (focused) ctx.rect(L, T, R - L, B - T);
          else
            for (const [cx, cy, sx, sy] of [
              [L, T, 1, 1],
              [R, T, -1, 1],
              [L, B, 1, -1],
              [R, B, -1, -1],
            ]) {
              ctx.moveTo(cx + sx * k, cy);
              ctx.lineTo(cx, cy);
              ctx.lineTo(cx, cy + sy * k);
            }
          ctx.stroke();
          if (!dim) {
            const text = `${track.id.toUpperCase()}${conf !== 0.9 ? ` ${Math.round(conf * 100)}` : ""}`;
            const tw = ctx.measureText(text).width + 8;
            ctx.fillStyle = col;
            ctx.fillRect(L, Math.max(0, T - 16), tw, 15);
            ctx.fillStyle = track.label === "person" ? "#fff" : "#0c0c0c";
            ctx.fillText(text, L + 4, Math.max(11, T - 5));
          }
        }
        ctx.globalAlpha = 1;
      }

      // Agent notes: a pill with a leader line to an object (followed) or a fixed point.
      ctx.font = `500 12px ${family}`;
      for (const n of notes) {
        if ((n.from !== undefined && t < n.from) || (n.to !== undefined && t > n.to)) continue;
        let ax: number;
        let ay: number;
        if (n.object) {
          const b = data && boxOf(data, n.object, t);
          if (!b) continue;
          ax = ox + ((b[1] + b[3]) / 2) * cw;
          ay = oy + b[2] * ch;
        } else {
          ax = ox + (n.x ?? 0.5) * cw;
          ay = oy + (n.y ?? 0.2) * ch;
        }
        const tw = ctx.measureText(n.text).width + 20;
        const px = Math.min(Math.max(4, ax - tw / 2), W - tw - 4);
        const py = Math.max(4, ay - (n.object ? 52 : 14));
        if (n.object) {
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay - 2);
          ctx.lineTo(ax, py + 24);
          ctx.stroke();
          ctx.fillStyle = ACCENT;
          ctx.beginPath();
          ctx.arc(ax, ay - 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(12,12,12,0.86)";
        ctx.beginPath();
        ctx.roundRect(px, py, tw, 24, 6);
        ctx.fill();
        ctx.fillStyle = ACCENT;
        ctx.fillRect(px, py + 5, 3, 14);
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(n.text, px + 11, py + 12.5);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full font-mono" />;
}
