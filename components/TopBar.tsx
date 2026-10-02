"use client";

import { useEffect, useState } from "react";
import { HailmaryLogo } from "./Brand";
import { StatusDot, Tooltip, type Tone } from "./ui";
import type { AgentState } from "./Raccoon";

export type Health = Record<string, string>;

const SERVICES: [key: string, label: string, role: string][] = [
  ["vss", "VSS", "Archive search, VAST S3 + VastDB"],
  ["cosmos", "Cosmos", "NVIDIA Cosmos3-Reason"],
  ["yolo", "YOLO", "YOLO11 object detection"],
  ["edit", "fal", "Generative video editing"],
  ["voice", "Voice", "ElevenLabs agent"],
  ["polish", "W&B", "Edit-prompt rewriting"],
];

const toneOf = (v?: string): Tone =>
  !v ? "idle" : v.startsWith("ok") || v === "configured" ? "ok" : v.startsWith("off") ? "idle" : "danger";

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="font-mono text-xs text-fg-muted">
      {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export function TopBar({ health, state, startedAt }: { health?: Health; state: AgentState; startedAt?: number }) {
  const issues = health ? SERVICES.filter(([k]) => toneOf(health[k]) === "danger") : [];
  const live = state !== "idle" && state !== "connecting";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b bg-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <HailmaryLogo className="h-[17px] w-auto shrink-0 text-fg" />
        <span className="hidden h-4 w-px rotate-[20deg] bg-line-strong sm:block" />
        <span className="hidden truncate text-[13px] font-light text-fg-subtle sm:inline">Archive console</span>
      </div>

      <div className="flex items-center gap-5">
        <ul className="hidden items-center gap-4 xl:flex" aria-label="System status">
          {SERVICES.map(([k, label, role]) => (
            <li key={k}>
              <Tooltip
                align="end"
                content={
                  <>
                    <span className="block text-fg">{role}</span>
                    <span className="font-mono text-[11px]">{health?.[k] ?? "checking…"}</span>
                  </>
                }
              >
                <span className="flex cursor-default items-center gap-1.5 text-xs text-fg-subtle">
                  <StatusDot tone={toneOf(health?.[k])} pulse={!health} />
                  {label}
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>

        <Tooltip
          align="end"
          content={
            health ? (
              <span className="block space-y-0.5">
                {SERVICES.map(([k, label]) => (
                  <span key={k} className="flex gap-2 font-mono text-[11px]">
                    <span className="w-12 text-fg-subtle">{label}</span>
                    <span>{health[k]}</span>
                  </span>
                ))}
              </span>
            ) : (
              "Checking services…"
            )
          }
        >
          <span className="flex cursor-default items-center gap-2 text-xs text-fg-subtle xl:hidden">
            <StatusDot tone={!health ? "idle" : issues.length ? "danger" : "ok"} pulse={!health} />
            {!health ? "Checking" : issues.length ? `${issues.length} degraded` : "All systems normal"}
          </span>
        </Tooltip>

        <span className="hidden h-4 w-px bg-line-strong sm:block" />

        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <StatusDot tone={live ? "ok" : state === "connecting" ? "info" : "idle"} pulse={state === "connecting"} />
          {live && startedAt ? <Elapsed since={startedAt} /> : state === "connecting" ? "Connecting" : "No session"}
        </span>
      </div>
    </header>
  );
}
