"use client";

import { ArrowUp, CircleAlert, LoaderCircle, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Button, PanelHeader, StatusDot, clockTime, cx, type Tone } from "./ui";
import { Raccoon, type AgentState } from "./Raccoon";

const SUGGESTIONS = [
  "Was anyone too close to a forklift in the warehouse?",
  "Put the top four on a grid",
  "Show me the other camera angle",
  "Zoom in and follow the forklift, slow motion",
  "Remove the person from this clip",
  "Give me a card with what's in this clip",
];

const STATE: Record<AgentState, { label: string; tone: Tone; hint: string }> = {
  idle: { label: "Offline", tone: "idle", hint: "Start a session to talk to the archive." },
  connecting: { label: "Connecting", tone: "info", hint: "Opening a secure voice session…" },
  listening: { label: "Listening", tone: "ok", hint: "Go ahead. Ask for any moment." },
  thinking: { label: "Working", tone: "info", hint: "Running tools against the archive…" },
  speaking: { label: "Speaking", tone: "ok", hint: "Interrupt any time." },
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

  return (
    <section className="flex min-h-[520px] flex-col bg-panel lg:min-h-0 lg:border-r">
      <PanelHeader title="Agent">
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <StatusDot tone={meta.tone} pulse={state === "connecting" || state === "thinking"} />
          {meta.label}
        </span>
      </PanelHeader>

      <div className="flex shrink-0 flex-col items-center gap-4 px-5 pb-5 pt-2">
        <Raccoon mode={state} getInput={conv.getInputVolume} getOutput={conv.getOutputVolume} size={220} />
        <p className="h-4 text-center text-xs text-fg-subtle">{meta.hint}</p>

        {live ? (
          <div className="flex w-full items-center gap-2">
            <Button className="flex-1" onClick={() => conv.setMuted(!conv.isMuted)} aria-pressed={conv.isMuted}>
              {conv.isMuted ? <MicOff size={15} strokeWidth={1.5} /> : <Mic size={15} strokeWidth={1.5} />}
              {conv.isMuted ? "Unmute" : "Mute"}
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => conv.endSession()}>
              <PhoneOff size={15} strokeWidth={1.5} />
              End session
            </Button>
          </div>
        ) : (
          <Button variant="primary" className="w-full" onClick={onStart} disabled={state === "connecting"}>
            {state === "connecting" ? (
              <LoaderCircle size={15} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Mic size={15} strokeWidth={1.5} />
            )}
            {state === "connecting" ? "Connecting" : "Start session"}
          </Button>
        )}

        {error && (
          <div role="alert" className="flex w-full items-start gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-xs text-danger">
            <CircleAlert size={14} strokeWidth={1.5} className="mt-px shrink-0" />
            <span className="flex-1 leading-snug">{error}</span>
            <button type="button" aria-label="Dismiss" onClick={onDismissError} className="text-danger/70 hover:text-danger">
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      <Transcript live={live} onSend={onSend} />
      <Composer live={live} onSend={onSend} />
    </section>
  );
}

function Transcript({ live, onSend }: { live: boolean; onSend: (text: string) => void }) {
  const lines = useStore((s) => s.transcript);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const asked = lines.some((l) => l.role === "user");

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto border-t px-5 py-5">
      {lines.length > 0 && (
        <ol className="space-y-4">
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <motion.li
                key={l.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={cx("flex flex-col gap-1", l.role === "user" && "items-end")}
              >
                <span className="font-mono text-[10px] text-fg-faint">
                  {l.role === "user" ? "You" : "Hailmary"} · {clockTime(l.at)}
                </span>
                {l.role === "user" ? (
                  <p className="max-w-[88%] rounded-lg bg-raised px-3 py-2 text-[13px] leading-relaxed text-fg">{l.text}</p>
                ) : (
                  <p className="text-[13px] leading-relaxed text-fg">{l.text}</p>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
      {!asked && (
        <div className={cx("space-y-3", lines.length > 0 && "mt-6")}>
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">Try asking</p>
          <ul className="space-y-1.5">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={!live}
                  onClick={() => onSend(s)}
                  className={cx(
                    "w-full rounded-md border px-3 py-2 text-left text-[13px] leading-snug transition-colors",
                    live ? "text-fg-muted hover:border-line-strong hover:bg-raised hover:text-fg" : "cursor-default text-fg-subtle",
                  )}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Composer({ live, onSend }: { live: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || !live) return;
    onSend(t);
    setText("");
  };
  return (
    <form
      className="shrink-0 border-t p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        className={cx(
          "flex items-center gap-2 rounded-md border bg-raised pl-3 pr-1.5 transition-colors",
          live ? "border-line-strong focus-within:border-fg-subtle" : "border-line",
        )}
      >
        <input
          aria-label="Message the agent"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!live}
          placeholder={live ? "Message Hailmary" : "Start a session to type"}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-faint focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!live || !text.trim()}
          className="flex size-7 items-center justify-center rounded-[5px] bg-fg text-panel transition-opacity disabled:opacity-20"
        >
          <ArrowUp size={14} strokeWidth={1.75} />
        </button>
      </div>
    </form>
  );
}
