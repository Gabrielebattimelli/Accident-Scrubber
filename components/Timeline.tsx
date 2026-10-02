"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Detections } from "@/lib/types";
import { ACCENT } from "./DetectionOverlay";
import { store, useStore } from "./store";
import { tellAgent } from "./useAgentTools";

// Sightline's object timeline: how many (visible) objects are in frame over the clip, the playhead,
// and the moments the agent marked. Click anywhere to jump there.
export function Timeline({ video, clipId, data }: { video: RefObject<HTMLVideoElement | null>; clipId: string; data?: Detections }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const labels = useStore((s) => s.overlay.labels);
  const markers = useStore((s) => s.markers);
  const latest = useRef({ data, labels, markers });
  useEffect(() => {
    latest.current = { data, labels, markers };
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = video.current;
      if (!v) return;
      const { data, labels, markers } = latest.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const dur = v.duration || 5;
      const base = H - 12;
      ctx.fillStyle = "#e6e6e9";
      ctx.fillRect(0, base, W, 3);
      if (data?.frames.length) {
        const counts = data.frames.map(
          (f) => f.filter((b) => b[5] >= 0.35 && (!labels.length || labels.some((l) => data.tracks[b[0]].label.includes(l)))).length,
        );
        const max = Math.max(1, ...counts);
        counts.forEach((n, i) => {
          const x = (data.times[i] / dur) * W;
          const w = Math.max(1, ((data.times[i + 1] ?? dur) - data.times[i]) / dur * W - 0.5);
          const h = (n / max) * (base - 18);
          ctx.fillStyle = "#d4d4d8";
          ctx.fillRect(x, base - 2 - h, w, h);
        });
      }
      ctx.font = "500 10px ui-monospace, monospace";
      ctx.textBaseline = "top";
      for (const m of markers) {
        if (m.clipId !== clipId) continue;
        const x = (m.t / dur) * W;
        ctx.fillStyle = ACCENT;
        ctx.fillRect(x - 1, 2, 2, base);
        ctx.beginPath();
        ctx.moveTo(x - 5, base + 4);
        ctx.lineTo(x + 5, base + 4);
        ctx.lineTo(x, base - 2);
        ctx.fill();
        const tw = ctx.measureText(m.label).width;
        ctx.fillText(m.label, Math.min(Math.max(0, x + 4), W - tw), 2);
      }
      const px = (v.currentTime / dur) * W;
      ctx.fillStyle = "#0b0b0d";
      ctx.fillRect(px - 1, 0, 2, H);
      if (clock.current) clock.current.textContent = `${v.currentTime.toFixed(1)}s / ${dur.toFixed(1)}s`;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, clipId]);

  const seek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const v = video.current;
    if (!v) return;
    const t = (e.nativeEvent.offsetX / e.currentTarget.clientWidth) * (v.duration || 5);
    store.set({ seek: { clipId, t, pause: v.paused, n: Date.now() } });
    tellAgent(`user jumped clip ${clipId} to ${t.toFixed(1)}s`);
  };

  return (
    <div className="mt-2 rounded-lg border bg-panel px-3 pb-1.5 pt-2">
      <canvas ref={canvas} onClick={seek} className="block h-14 w-full cursor-pointer" />
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em] text-fg-faint">
        <span>{data ? `Objects in frame · ${data.via}` : "Timeline · turn on boxes for object counts"}</span>
        <span ref={clock} />
      </div>
    </div>
  );
}
