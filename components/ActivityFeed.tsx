"use client";

import { Spinner } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "./store";

const ICON: Record<string, string> = {
  search_archive: "⌕",
  ask_archive: "?",
  list_cameras: "▦",
  show_clip: "▶",
  look_closer: "◉",
  detect_objects: "▣",
  summarize_video: "≡",
  edit_clip: "✎",
  check_edit: "↻",
  verify_clip: "⛨",
};

const STACK: Record<string, string> = {
  search_archive: "VSS · Cosmos Embed · VastDB",
  ask_archive: "VSS agent · Cosmos3-Reason",
  look_closer: "Cosmos3-Reason",
  detect_objects: "YOLO11",
  summarize_video: "VSS synthesize",
  edit_clip: "W&B → fal",
  verify_clip: "SHA-256 · Cosmos3-Reason",
};

export function ActivityFeed() {
  const activity = useStore((s) => s.activity);
  return (
    <div className="space-y-1.5">
      <h2 className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-muted">Agent tool calls</h2>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {activity.slice(0, 7).map((a) => (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-surface/70 px-3 py-2 backdrop-blur"
            >
              <span className="mt-0.5 w-4 text-center font-mono text-sm text-scrub">{ICON[a.tool] || "•"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{a.label}</span>
                  {a.status === "running" && <Spinner size="sm" color="current" />}
                  {a.status === "error" && <span className="font-mono text-[10px] text-danger">FAILED</span>}
                </div>
                <div className="truncate font-mono text-[10px] text-muted">
                  {STACK[a.tool] && <span className="text-think">{STACK[a.tool]}</span>}
                  {a.ms !== undefined && <span> · {(a.ms / 1000).toFixed(1)}s</span>}
                  {a.detail && <span> · {a.detail}</span>}
                </div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
