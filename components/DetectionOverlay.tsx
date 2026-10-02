"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Detections } from "@/lib/types";

const CLASS_COLORS: Record<string, string> = {
  car: "#38bdf8",
  truck: "#fbbf24",
  bus: "#a78bfa",
  person: "#4ade80",
  motorcycle: "#f472b6",
  bicycle: "#fb7185",
};
const FALLBACK = ["#2dd4bf", "#fb923c", "#c084fc", "#facc15", "#60a5fa", "#f87171"];

export function colorFor(label: string) {
  if (CLASS_COLORS[label]) return CLASS_COLORS[label];
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

/** Index of the last sampled frame at or before `t` (seconds). */
function frameAt(times: number[], t: number) {
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

const TRAIL_FRAMES = 60;

/** Draws tracked YOLO boxes over a playing <video>, following its currentTime. */
export function DetectionOverlay({
  video,
  data,
  labels,
  focus,
}: {
  video: RefObject<HTMLVideoElement | null>;
  data: Detections;
  labels: string[]; // empty = every class
  focus?: string; // track id to highlight
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ data, labels, focus });
  useEffect(() => {
    latest.current = { data, labels, focus };
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
      const { data, labels, focus: focusId } = latest.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // The video is object-contain: map 0–1 frame coordinates into the letterboxed picture.
      const vw = v.videoWidth || data.aspect;
      const vh = v.videoHeight || 1;
      const s = Math.min(W / vw, H / vh);
      const cw = vw * s;
      const ch = vh * s;
      const ox = (W - cw) / 2;
      const oy = (H - ch) / 2;
      const i = frameAt(data.times, v.currentTime);
      if (i < 0) return;

      const focus = focusId ? data.tracks.findIndex((t) => t.id === focusId) : -1;
      const visible = (ti: number) => ti === focus || !labels.length || labels.includes(data.tracks[ti].label);

      if (focus >= 0) {
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

      ctx.font = `500 10px ${family}`;
      ctx.textBaseline = "middle";
      for (const [ti, x1, y1, x2, y2, conf] of data.frames[i] || []) {
        if (!visible(ti)) continue;
        const track = data.tracks[ti];
        const focused = ti === focus;
        const dim = focus >= 0 && !focused;
        const color = focused ? "#ffffff" : colorFor(track.label);
        const x = ox + x1 * cw;
        const y = oy + y1 * ch;
        const w = (x2 - x1) * cw;
        const h = (y2 - y1) * ch;
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = focused ? 2.5 : 1.5;
        ctx.strokeRect(x, y, w, h);
        if (!dim) {
          const text = `${track.id} ${Math.round(conf * 100)}%`;
          const tw = ctx.measureText(text).width + 8;
          const ty = y - 16 >= oy ? y - 16 : y;
          ctx.fillStyle = color;
          ctx.fillRect(x - (focused ? 1.25 : 0.75), ty, tw, 16);
          ctx.fillStyle = "#0b0b0d";
          ctx.fillText(text, x + 4 - (focused ? 1.25 : 0.75), ty + 8.5);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full font-mono" />;
}
