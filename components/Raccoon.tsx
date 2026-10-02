"use client";

import { useEffect, useId, useRef } from "react";

export type AgentState = "idle" | "connecting" | "listening" | "speaking" | "thinking";

const COLORS: Record<AgentState, [number, number, number]> = {
  idle: [138, 147, 168],
  connecting: [138, 147, 168],
  listening: [56, 189, 248],
  speaking: [255, 90, 54],
  thinking: [167, 112, 255],
};

const FUR = "#8b909a";
const FUR_DARK = "#5c616b";
const MASK = "#1f2025";
const CREAM = "#f5f5f6";

const clamp01 = (fn?: () => number) => {
  try {
    return Math.min(1, Math.max(0, fn?.() ?? 0));
  } catch {
    return 0;
  }
};
const ease = (cur: number, goal: number, k: number) => cur + (goal - cur) * k;

/**
 * Audio-reactive raccoon mascot. Volume getters are read every frame through refs, and the
 * SVG parts are moved directly, so React never re-renders while it animates.
 */
export function Raccoon({
  mode,
  getInput,
  getOutput,
  size = 220,
}: {
  mode: AgentState;
  getInput?: () => number;
  getOutput?: () => number;
  size?: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const tailClip = `tail${useId().replace(/[^\w-]/g, "")}`;
  const modeRef = useRef(mode);
  const inRef = useRef(getInput);
  const outRef = useRef(getOutput);
  useEffect(() => {
    modeRef.current = mode;
    inRef.current = getInput;
    outRef.current = getOutput;
  });

  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    const q = (k: string) => root.querySelector<SVGElement>(`[data-p="${k}"]`)!;
    const all = (k: string) => [...root.querySelectorAll<SVGElement>(`[data-p="${k}"]`)];
    const p = {
      halo: q("halo"),
      ripple: q("ripple"),
      ring: q("ring"),
      tail: q("tail"),
      head: q("head"),
      earL: q("earL"),
      earR: q("earR"),
      browL: q("browL"),
      browR: q("browR"),
      eyeL: q("eyeL"),
      eyeR: q("eyeR"),
      mouth: q("mouth"),
      glass: q("glass"),
      pupils: all("pupil"),
      irises: all("iris"),
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const amp = reduce ? 0.3 : 1;

    let pointer: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY });
    const onLeave = () => (pointer = null);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let level = 0;
    let gx = 0;
    let gy = 0;
    let tilt = 0;
    let perk = 0;
    let brow = 0;
    let skew = 0;
    let mouth = 0;
    let glass = 0;
    let blinkAt = 1.5;
    let blinkT = -1;
    let twitchAt = 3;
    let twitchT = -1;
    let twitchSide = 1;
    const color = [...COLORS.idle];

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const m = modeRef.current;
      const inp = clamp01(inRef.current);
      const out = clamp01(outRef.current);

      const target =
        m === "speaking"
          ? 0.15 + out * 1.4
          : m === "listening"
            ? 0.08 + inp * 1.6
            : m === "thinking"
              ? 0.22 + 0.08 * Math.sin(t * 4)
              : m === "connecting"
                ? 0.1 + 0.06 * Math.sin(t * 6)
                : 0.05 + 0.02 * Math.sin(t * 1.5);
      level = ease(level, Math.min(target, 1), 0.12);
      const goal = COLORS[m];
      for (let i = 0; i < 3; i++) color[i] += (goal[i] - color[i]) * 0.06;
      const rgb = `rgb(${color.map(Math.round).join(",")})`;

      // Backdrop: halo, listening ripple, working ring.
      p.halo.setAttribute("r", (72 + level * 20).toFixed(2));
      p.halo.setAttribute("fill", rgb);
      p.halo.setAttribute("fill-opacity", (0.13 + level * 0.17).toFixed(3));
      const rp = (t * 0.6) % 1;
      p.ripple.setAttribute("r", (76 + rp * 18).toFixed(2));
      p.ripple.setAttribute("stroke", rgb);
      p.ripple.setAttribute("stroke-opacity", m === "listening" ? ((1 - rp) * 0.5).toFixed(3) : "0");
      p.ring.setAttribute("stroke", rgb);
      p.ring.setAttribute("opacity", m === "thinking" || m === "connecting" ? "0.85" : "0");
      p.ring.setAttribute("transform", `rotate(${((t * 126) % 360).toFixed(1)} 100 106)`);

      // Gaze: follows the pointer, looks up while thinking, scans while connecting.
      let tx = 0;
      let ty = 0;
      if (m === "thinking") {
        tx = 0.7;
        ty = -0.8;
      } else if (m === "connecting") {
        tx = Math.sin(t * 1.6);
      } else if (pointer) {
        const r = root.getBoundingClientRect();
        const dx = pointer.x - (r.left + r.width / 2);
        const dy = pointer.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260);
        tx = (dx / d) * k;
        ty = (dy / d) * k;
      }
      gx = ease(gx, tx, 0.15);
      gy = ease(gy, ty, 0.15);
      for (const el of p.pupils) el.setAttribute("transform", `translate(${(gx * 3).toFixed(2)} ${(gy * 2.6).toFixed(2)})`);
      for (const el of p.irises) el.setAttribute("fill", rgb);

      // Blinks, sometimes doubled.
      if (t >= blinkAt && blinkT < 0) blinkT = 0;
      let lid = 1;
      if (blinkT >= 0) {
        blinkT += dt;
        const b = blinkT / 0.16;
        lid = Math.abs(1 - 2 * Math.min(b, 1));
        if (b >= 1) {
          blinkT = -1;
          blinkAt = t + (Math.random() < 0.2 ? 0.22 : 2.4 + Math.random() * 3.6);
        }
      }
      lid = Math.max(0.08, lid * (m === "thinking" ? 0.82 : 1));
      p.eyeL.setAttribute("transform", `translate(74 104) scale(1 ${lid.toFixed(3)})`);
      p.eyeR.setAttribute("transform", `translate(126 104) scale(1 ${lid.toFixed(3)})`);

      // Ears perk up to listen and flick now and then.
      perk = ease(perk, m === "listening" ? 1 : m === "thinking" ? 0.6 : m === "speaking" ? 0.4 : 0, 0.08);
      if (t >= twitchAt && twitchT < 0) {
        twitchT = 0;
        twitchSide = Math.random() < 0.5 ? -1 : 1;
      }
      let tw = 0;
      if (twitchT >= 0) {
        twitchT += dt;
        const e = twitchT / 0.3;
        tw = Math.sin(Math.min(e, 1) * Math.PI) * 14 * amp;
        if (e >= 1) {
          twitchT = -1;
          twitchAt = t + 3 + Math.random() * 5;
        }
      }
      const spread = 22 - perk * 10;
      const earScale = (1 + perk * 0.06 + (m === "listening" ? inp * 0.14 : 0)).toFixed(3);
      p.earL.setAttribute("transform", `translate(66 70) rotate(${(-spread - (twitchSide < 0 ? tw : 0)).toFixed(2)}) scale(${earScale})`);
      p.earR.setAttribute("transform", `translate(134 70) rotate(${(spread + (twitchSide > 0 ? tw : 0)).toFixed(2)}) scale(${earScale})`);

      // Head: curious tilt while thinking, bob while talking, slow breath otherwise.
      const tiltGoal =
        m === "thinking"
          ? 7 + Math.sin(t * 1.2) * 2
          : m === "connecting"
            ? Math.sin(t * 2.2) * 6
            : m === "listening"
              ? -4
              : m === "speaking"
                ? Math.sin(t * 6) * level * 5
                : Math.sin(t * 0.7) * 1.5;
      tilt = ease(tilt, tiltGoal * amp, 0.08);
      const bob = (m === "speaking" ? -level * 4 : 0) + Math.sin(t * 1.8) * 1.2 * amp;
      p.head.setAttribute("transform", `translate(0 ${bob.toFixed(2)}) rotate(${tilt.toFixed(2)} 100 150)`);

      brow = ease(brow, m === "thinking" ? -4 : m === "listening" ? -3 - inp * 4 : m === "speaking" ? -level * 3 : 0, 0.12);
      skew = ease(skew, m === "thinking" ? 3 : 0, 0.08);
      p.browL.setAttribute("transform", `translate(0 ${(brow + skew).toFixed(2)})`);
      p.browR.setAttribute("transform", `translate(0 ${(brow - skew).toFixed(2)})`);

      mouth = ease(mouth, m === "speaking" ? Math.min(1, out * 2.2) : 0, 0.35);
      p.mouth.setAttribute("ry", (mouth * 7).toFixed(2));
      p.mouth.setAttribute("opacity", mouth > 0.03 ? "1" : "0");

      glass = ease(glass, m === "thinking" ? 1 : 0, 0.1);
      p.glass.setAttribute("opacity", glass.toFixed(3));
      p.glass.setAttribute(
        "transform",
        `translate(146 ${(150 + (1 - glass) * 14).toFixed(2)}) rotate(${(Math.sin(t * 2) * 6 * amp).toFixed(2)})`,
      );

      const swish = Math.sin(t * (m === "speaking" ? 3.2 : m === "listening" ? 2 : 1.3)) * (7 + level * 10) * amp;
      p.tail.setAttribute("transform", `translate(146 136) rotate(${(swish + 4).toFixed(2)})`);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <svg ref={svg} viewBox="0 0 200 200" width={size} height={size} overflow="visible" aria-hidden>
      <defs>
        <clipPath id={tailClip}>
          <path d="M-9 4C-16-26-4-58 22-74C36-82 50-74 45-60C32-44 20-24 15 4Z" />
        </clipPath>
      </defs>

      <circle data-p="halo" cx="100" cy="106" r="72" />
      <circle data-p="ripple" cx="100" cy="106" r="76" fill="none" strokeWidth="1.5" />
      <circle data-p="ring" cx="100" cy="106" r="88" fill="none" strokeWidth="2" strokeDasharray="14 10" opacity="0" />

      <g data-p="tail" transform="translate(146 136)">
        <g clipPath={`url(#${tailClip})`}>
          <path d="M-9 4C-16-26-4-58 22-74C36-82 50-74 45-60C32-44 20-24 15 4Z" fill={FUR} />
          <path d="M-26-34L48-2M-18-52L56-20M-10-70L64-38" stroke={MASK} strokeWidth="9" />
          <circle cx="36" cy="-72" r="11" fill={MASK} />
        </g>
      </g>

      <g data-p="head">
        {(["earL", "earR"] as const).map((k) => (
          <g key={k} data-p={k} transform={k === "earL" ? "translate(66 70)" : "translate(134 70)"}>
            <path d="M-17 6C-18-14-10-30 0-33C10-30 18-14 17 6Z" fill={CREAM} />
            <path d="M-14 6C-15-12-8-26 0-29C8-26 15-12 14 6Z" fill={FUR_DARK} />
            <path d="M-8 4C-9-8-5-19 0-21C5-19 9-8 8 4Z" fill={MASK} />
          </g>
        ))}

        <path
          d="M100 48C138 48 166 74 168 104C169 116 164 126 156 132L166 142C150 150 140 154 128 157L134 164C122 166 110 167 100 167C90 167 78 166 66 164L72 157C60 154 50 150 34 142L44 132C36 126 31 116 32 104C34 74 62 48 100 48Z"
          fill={FUR}
        />
        <path d="M100 52C95 52 93 66 95 84L100 92L105 84C107 66 105 52 100 52Z" fill={FUR_DARK} />
        <path data-p="browL" d="M48 92C56 74 76 69 91 80C76 77 60 82 48 92Z" fill={CREAM} />
        <path data-p="browR" d="M152 92C144 74 124 69 109 80C124 77 140 82 152 92Z" fill={CREAM} />
        <path d="M58 124C64 108 86 104 100 113C114 104 136 108 142 124C148 142 126 160 100 161C74 160 52 142 58 124Z" fill={CREAM} />
        <path
          d="M40 106C44 88 66 80 84 90C92 94 96 100 100 100C104 100 108 94 116 90C134 80 156 88 160 106C162 120 148 126 134 123C122 121 110 115 100 115C90 115 78 121 66 123C52 126 38 120 40 106Z"
          fill={MASK}
        />

        {(["eyeL", "eyeR"] as const).map((k) => (
          <g key={k} data-p={k} transform={k === "eyeL" ? "translate(74 104)" : "translate(126 104)"}>
            <circle r="9.5" fill="#fff" />
            <g data-p="pupil">
              <circle data-p="iris" r="6" />
              <circle r="3.3" fill="#0b0b0d" />
              <circle cx="-2" cy="-2.2" r="1.6" fill="#fff" />
            </g>
          </g>
        ))}

        <circle cx="66" cy="139" r="6" fill="#f9a8b4" opacity="0.45" />
        <circle cx="134" cy="139" r="6" fill="#f9a8b4" opacity="0.45" />
        <path d="M91 124Q100 118 109 124Q107 132 100 133Q93 132 91 124Z" fill={MASK} />
        <ellipse cx="97" cy="123.5" rx="2.4" ry="1.2" fill="#fff" opacity="0.5" />
        <path d="M100 133V139M91 141Q96 145 100 139Q104 145 109 141" fill="none" stroke={MASK} strokeWidth="2" strokeLinecap="round" />
        <ellipse data-p="mouth" cx="100" cy="143" rx="6.5" ry="0" fill="#3a1f25" opacity="0" />

        <g data-p="glass" opacity="0" transform="translate(146 164)">
          <path d="M9 9L20 20" stroke={MASK} strokeWidth="5" strokeLinecap="round" />
          <circle r="13" fill="#fff" fillOpacity="0.45" stroke={MASK} strokeWidth="3.5" />
          <path d="M-6-5A8 8 0 0 1 2-8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="21" cy="22" rx="7" ry="6" fill={FUR_DARK} />
        </g>
      </g>
    </svg>
  );
}
