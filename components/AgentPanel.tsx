"use client";

import { ArrowRight, CircleAlert, LoaderCircle, Mic, MicOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { cx } from "./ui";
import { Raccoon, type AgentState } from "./Raccoon";

const SUGGESTIONS: [string, string[]][] = [
  ["Show me someone walking near a forklift", ["Show me the other camera angle", "Remove the person from this clip"]],
  ["Find pedestrians in a crosswalk in San Francisco", ["Remove the people", "Put the top four on a grid"]],
  ["Find the humanoid robot next to the pallet jack", ["Zoom in and follow the robot", "Show me the other camera angle"]],
  ["Show me a forklift in the warehouse", ["Add an oil spill in front of the forklift", "Make it night with puddles"]],
  ["Cyclist crossing an intersection in San Francisco", ["Remove the cyclist", "Give me a card with what's in this clip"]],
];

const FOLLOWUPS = ["Show me the other camera angle", "Put the top four on a grid", "Remove the person from this clip", "Zoom in and follow, slow motion", "Next clip"];

const STATE: Record<AgentState, { label: string; dot: string }> = {
  idle: { label: "Ready when you are", dot: "bg-line-strong" },
  connecting: { label: "Connecting…", dot: "bg-info soft-pulse" },
  listening: { label: "Listening", dot: "bg-ok soft-pulse" },
  thinking: { label: "Working", dot: "bg-fg soft-pulse" },
  speaking: { label: "Talking", dot: "bg-ok" },
};

type Conv = {
  isMuted: boolean;
  setMuted: (m: boolean) => void;
  endSession: () => void;
  getInputVolume: () => number;
  getOutputVolume: () => number;
};

export function AgentPanel({
  state,
  conv,
  error,
  onDismissError,
  onStart,
  onSend,
}: {
  state: AgentState;
  conv: Conv;
  error?: string;
  onDismissError: () => void;
  onStart: () => void;
  onSend: (text: string) => void;
}) {
  const live = state !== "idle" && state !== "connecting";
  const meta = STATE[state];
  const [followups, setFollowups] = useState<string[]>([]);

  const send = (text: string, next?: string[]) => {
    if (next) setFollowups(next);
    else setFollowups((f) => f.filter((x) => x !== text));
    onSend(text);
  };

  return (
    <section className="flex min-h-[520px] flex-col bg-panel lg:min-h-0 lg:border-r">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <button
          type="button"
          onClick={() => (live ? conv.setMuted(!conv.isMuted) : state === "idle" && onStart())}
          aria-label={live ? (conv.isMuted ? "Unmute" : "Mute") : "Start talking"}
          className="shrink-0 rounded-full"
        >
          <Raccoon mode={state} getInput={conv.getInputVolume} getOutput={conv.getOutputVolume} size={148} />
        </button>
        <div className="min-w-0">
          <h2 className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-fg">Raccoon</h2>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-fg-muted">
            <span className={cx("size-[7px] shrink-0 rounded-full", live && conv.isMuted ? "bg-warn" : meta.dot)} />
            {live && conv.isMuted ? "Muted" : meta.label}
          </p>
          {live && (
            <button type="button" onClick={() => conv.endSession()} className="mt-1.5 text-xs text-fg-subtle underline-offset-2 hover:text-danger hover:underline">
              End session
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
          <CircleAlert size={14} strokeWidth={1.5} className="mt-px shrink-0" />
          <span className="flex-1 leading-snug">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={onDismissError} className="text-danger/70 hover:text-danger">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <Thread state={state} onPick={(q, next) => send(q, next)} />
      <Composer
        state={state}
        muted={conv.isMuted}
        chips={[...new Set([...followups, ...FOLLOWUPS])].slice(0, 5)}
        onMic={() => (live ? conv.setMuted(!conv.isMuted) : state === "idle" && onStart())}
        onSend={(t) => send(t)}
      />
    </section>
  );
}

type Item = { key: string; at: number; kind: "user" | "agent" | "step"; text: string; status?: "running" | "done" | "error"; ms?: number };

function Thread({ state, onPick }: { state: AgentState; onPick: (q: string, next: string[]) => void }) {
  const lines = useStore((s) => s.transcript);
  const activity = useStore((s) => s.activity);
  const scroller = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(
    () =>
      [
        ...lines.map((l) => ({ key: `l${l.id}`, at: l.at, kind: l.role, text: l.text }) as Item),
        ...activity.map((a) => ({ key: `a${a.id}`, at: a.at, kind: "step", text: a.label, status: a.status, ms: a.ms }) as Item),
      ].sort((a, b) => a.at - b.at),
    [lines, activity],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items.length, state]);

  const asked = lines.some((l) => l.role === "user");
  const last = items[items.length - 1];
  const typing = state === "thinking" || (asked && last?.kind === "user" && state !== "idle");

  return (
    <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
      <p className="text-[13.5px] text-fg-muted">What are we looking for?</p>
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div
            key={it.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={cx(
              it.kind === "user" && "max-w-[92%] self-end rounded-[14px_14px_4px_14px] bg-fg px-[13px] py-2 text-[14px] leading-snug text-panel",
              it.kind === "agent" && "max-w-[92%] self-start rounded-[14px_14px_14px_4px] bg-raised px-[13px] py-2 text-[14.5px] leading-snug text-fg",
              it.kind === "step" && "flex items-center gap-2 self-start pl-0.5 font-mono text-[11.5px] text-fg-muted",
            )}
          >
            {it.kind === "step" && <StepDot status={it.status} />}
            {it.kind === "step" ? (
              <span className={cx("truncate", it.status === "error" && "text-danger")}>
                {it.text}
                {it.ms !== undefined && <span className="text-fg-faint"> · {(it.ms / 1000).toFixed(1)}s</span>}
              </span>
            ) : (
              it.text
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      {typing && (
        <div className="flex gap-1 self-start rounded-[14px_14px_14px_4px] bg-raised px-3.5 py-3">
          {[0, 0.15, 0.3].map((d) => (
            <span key={d} className="size-[5px] animate-bounce rounded-full bg-fg-faint" style={{ animationDelay: `${d}s`, animationDuration: "1s" }} />
          ))}
        </div>
      )}
      {!asked && (
        <div className="mt-1">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">Try one</p>
          <ul className="border-t">
            {SUGGESTIONS.map(([q, next]) => (
              <li key={q}>
                <button
                  type="button"
                  disabled={state === "connecting"}
                  onClick={() => onPick(q, next)}
                  className="group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 border-b py-2.5 text-left"
                >
                  <span className="text-[13px] font-medium leading-snug text-fg">{q}</span>
                  <ArrowRight size={14} strokeWidth={1.75} className="row-span-2 text-line-strong transition group-hover:translate-x-0.5 group-hover:text-fg" />
                  <span className="text-[11.5px] leading-snug text-fg-subtle">then {next.map((n) => n.toLowerCase()).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StepDot({ status }: { status?: Item["status"] }) {
  if (status === "running") return <span className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-fg" />;
  return <span className={cx("mx-0.5 size-1.5 shrink-0 rounded-full", status === "error" ? "bg-danger" : "bg-ok")} />;
}

function Composer({
  state,
  muted,
  chips,
  onMic,
  onSend,
}: {
  state: AgentState;
  muted: boolean;
  chips: string[];
  onMic: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const live = state !== "idle" && state !== "connecting";
  const asked = useStore((s) => s.transcript.some((l) => l.role === "user"));
  const hot = live && !muted;
  const submit = () => {
    const t = text.trim();
    if (!t || state === "connecting") return;
    onSend(t);
    setText("");
  };
  return (
    <div className="shrink-0 border-t px-4 pb-3.5 pt-3">
      {asked && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onSend(c)}
              className="rounded-full border bg-panel px-[11px] py-[5px] text-[12.5px] text-fg transition-colors hover:border-fg"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-1.5 rounded-full border bg-canvas p-[5px] transition-colors focus-within:border-fg focus-within:bg-panel"
      >
        <button
          type="button"
          onClick={onMic}
          disabled={state === "connecting"}
          aria-label={live ? (muted ? "Unmute" : "Mute") : "Start talking"}
          className={cx(
            "grid size-9 shrink-0 place-items-center rounded-full border transition",
            hot ? "scale-105 border-[#ff5a1f] bg-[#ff5a1f] text-white" : "bg-panel text-fg",
          )}
        >
          {state === "connecting" ? (
            <LoaderCircle size={15} strokeWidth={1.75} className="animate-spin" />
          ) : live && muted ? (
            <MicOff size={15} strokeWidth={1.75} />
          ) : (
            <Mic size={15} strokeWidth={1.75} />
          )}
        </button>
        <input
          aria-label="Message Raccoon"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Raccoon"
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[14px] text-fg placeholder:text-fg-faint focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim() || state === "connecting"}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-panel transition-opacity disabled:opacity-20"
        >
          <ArrowRight size={15} strokeWidth={2.4} />
        </button>
      </form>
      <p className="mt-[7px] text-center text-xs text-fg-faint">
        {live ? (muted ? "Muted · tap the mic to talk again" : "Live · just talk, or type") : "Tap the mic to talk, or just type"}
      </p>
    </div>
  );
}
