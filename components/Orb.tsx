"use client";

import { useEffect, useRef } from "react";

export type OrbMode = "idle" | "connecting" | "listening" | "speaking" | "thinking";

const COLORS: Record<OrbMode, [number, number, number]> = {
  idle: [138, 147, 168],
  connecting: [138, 147, 168],
  listening: [94, 224, 255],
  speaking: [255, 90, 54],
  thinking: [176, 124, 255],
};

/**
 * Audio-reactive orb drawn on a canvas. Reads mic/agent volume every frame through the
 * getters (refs, so the render loop never restarts) and morphs a noisy blob around them.
 */
export function Orb({
  mode,
  getInput,
  getOutput,
  size = 320,
}: {
  mode: OrbMode;
  getInput?: () => number;
  getOutput?: () => number;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const inRef = useRef(getInput);
  const outRef = useRef(getOutput);
  useEffect(() => {
    modeRef.current = mode;
    inRef.current = getInput;
    outRef.current = getOutput;
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = size * dpr;
    el.height = size * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let t = 0;
    let level = 0;
    const color = [...COLORS.idle];

    const safe = (fn?: () => number) => {
      try {
        return Math.min(1, Math.max(0, fn?.() ?? 0));
      } catch {
        return 0;
      }
    };

    const draw = () => {
      t += 1 / 60;
      const m = modeRef.current;
      const target =
        m === "speaking"
          ? 0.15 + safe(outRef.current) * 1.4
          : m === "listening"
            ? 0.08 + safe(inRef.current) * 1.6
            : m === "thinking"
              ? 0.22 + 0.08 * Math.sin(t * 4)
              : m === "connecting"
                ? 0.1 + 0.06 * Math.sin(t * 6)
                : 0.05 + 0.02 * Math.sin(t * 1.5);
      level += (Math.min(target, 1) - level) * 0.12;
      const goal = COLORS[m];
      for (let i = 0; i < 3; i++) color[i] += (goal[i] - color[i]) * 0.06;
      const [r, g, b] = color.map(Math.round);

      const c = size / 2;
      const R = size * 0.27;
      ctx.clearRect(0, 0, size, size);

      // halo
      const halo = ctx.createRadialGradient(c, c, R * 0.4, c, c, R * (1.9 + level));
      halo.addColorStop(0, `rgba(${r},${g},${b},${0.35 + level * 0.3})`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // blob
      const N = 96;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wobble =
          Math.sin(a * 3 + t * 1.7) * 0.5 + Math.sin(a * 5 - t * 2.3) * 0.3 + Math.sin(a * 8 + t * 3.1) * 0.2;
        const rad = R * (1 + wobble * (0.04 + level * 0.28));
        const x = c + Math.cos(a) * rad;
        const y = c + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const fill = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R * 1.3);
      fill.addColorStop(0, `rgba(255,255,255,0.95)`);
      fill.addColorStop(0.25, `rgba(${r},${g},${b},0.95)`);
      fill.addColorStop(1, `rgba(${Math.round(r * 0.25)},${Math.round(g * 0.25)},${Math.round(b * 0.3)},0.95)`);
      ctx.fillStyle = fill;
      ctx.fill();

      // orbiting ring while a tool runs
      if (m === "thinking" || m === "connecting") {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(t * 2.2);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([R * 0.25, R * 0.18]);
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ripple while listening
      if (m === "listening") {
        const p = (t * 0.6) % 1;
        ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - p) * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(c, c, R * (1.15 + p * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvas} style={{ width: size, height: size }} aria-hidden />;
}
