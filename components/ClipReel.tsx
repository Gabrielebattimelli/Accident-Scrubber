"use client";

import { AnimatePresence, motion } from "motion/react";
import { fmtTime, videoSrc } from "@/lib/client";
import type { Clip } from "@/lib/types";
import { store, useStore } from "./store";

function ClipCard({ clip, active }: { clip: Clip; active: boolean }) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      onClick={() => store.set({ activeClipId: clip.id, activeEditId: undefined, verify: undefined })}
      className={`group relative w-56 shrink-0 overflow-hidden rounded-xl border text-left transition-colors ${
        active ? "border-scrub shadow-[0_0_0_1px_var(--scrub),0_0_30px_-6px_var(--scrub)]" : "border-border hover:border-muted"
      } bg-surface`}
    >
      <div className="relative aspect-video bg-black">
        <video
          src={`${videoSrc(clip.source)}#t=0.5`}
          muted
          playsInline
          loop
          preload="metadata"
          className="h-full w-full object-cover"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-lg font-bold leading-none text-white backdrop-blur">
          {clip.id}
        </span>
        {clip.score !== undefined && (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
            {clip.score.toFixed(2)}
          </span>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          <span className="truncate">{clip.cameraId || "camera"}</span>
          {clip.start !== undefined && <span>· {fmtTime(clip.start)}</span>}
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-foreground/80">{clip.caption || "—"}</p>
      </div>
    </motion.button>
  );
}

export function ClipReel() {
  const clips = useStore((s) => s.clips);
  const active = useStore((s) => s.activeClipId);
  const query = useStore((s) => s.lastQuery);
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Archive hits {query && <span className="normal-case tracking-normal text-foreground/70">· “{query}”</span>}
        </h2>
        <span className="font-mono text-xs text-muted">{clips.length} clips</span>
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
        <AnimatePresence initial={false}>
          {clips.map((c) => (
            <ClipCard key={c.source} clip={c} active={c.id === active} />
          ))}
        </AnimatePresence>
        {clips.length === 0 && (
          <div className="flex h-36 w-full items-center justify-center rounded-xl border border-dashed border-border font-mono text-xs text-muted">
            Ask for a moment. Results land here, numbered so you can say “edit clip 2”.
          </div>
        )}
      </div>
    </section>
  );
}
