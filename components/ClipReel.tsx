"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { BASE, fmtTime, videoSrc } from "@/lib/client";
import type { Clip } from "@/lib/types";
import { store, useStore } from "./store";
import { tellAgent } from "./useAgentTools";
import { Label, cx, pad2 } from "./ui";

/** Still thumbnail from /api/thumb (ffmpeg); falls back to a paused <video> where ffmpeg is missing. */
function Thumb({ clip }: { clip: Clip }) {
  const [still, setStill] = useState(true);
  return still ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${BASE}/api/thumb?source=${encodeURIComponent(clip.source)}`}
      alt=""
      loading="lazy"
      onError={() => setStill(false)}
      className="h-full w-full object-cover"
    />
  ) : (
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
  );
}

function ClipCard({ clip, active, edits, spot }: { clip: Clip; active: boolean; edits: number; spot: boolean }) {
  return (
    <motion.button
      type="button"
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={() => {
        store.set({ activeClipId: clip.id, activeEditId: undefined, verify: undefined, layout: { mode: "single" }, zoom: undefined });
        tellAgent(`user opened clip ${clip.id} (${[clip.cameraId, clip.view, clip.location].filter(Boolean).join(", ")})`);
      }}
      aria-pressed={active}
      className={cx(
        "group overflow-hidden rounded-md border bg-panel text-left transition-colors",
        active ? "border-fg-subtle" : "hover:border-line-strong",
        spot && "ring-2 ring-[#ff5a1f] ring-offset-1",
      )}
    >
      <div className="relative aspect-video bg-black">
        <Thumb clip={clip} />
        <span
          className={cx(
            "absolute left-1.5 top-1.5 rounded-[4px] px-1.5 py-0.5 font-mono text-[11px] leading-none",
            active ? "bg-white text-black" : "bg-black/75 text-white",
          )}
        >
          {pad2(clip.id)}
        </span>
        {clip.score !== undefined && (
          <span className="absolute right-1.5 top-1.5 rounded-[4px] bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/70">
            {clip.score.toFixed(2)}
          </span>
        )}
        {edits > 0 && (
          <span className="absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/75 px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-video-warn">
            {edits} edit{edits > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="space-y-1 px-2.5 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase text-fg-subtle">
          <span className="truncate">{clip.view || clip.cameraId || "camera"}</span>
          {clip.start !== undefined && <span className="shrink-0">{fmtTime(clip.start)}</span>}
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-fg-muted">{clip.caption || "No caption"}</p>
      </div>
    </motion.button>
  );
}

export function ClipReel() {
  const clips = useStore((s) => s.clips);
  const active = useStore((s) => s.activeClipId);
  const query = useStore((s) => s.lastQuery);
  const edits = useStore((s) => s.edits);
  const spotlight = useStore((s) => s.spotlight);
  const editCount = (source: string) => Object.values(edits).filter((e) => e.source === source).length;

  return (
    <section className="border-t">
      <div className="flex h-11 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2">
          <Label>Results</Label>
          <span className="font-mono text-[11px] text-fg-faint">{clips.length}</span>
        </div>
        {query && <span className="min-w-0 truncate text-xs text-fg-subtle">“{query}”</span>}
      </div>
      <div className="px-4 pb-4">
        {clips.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-md border border-dashed text-xs text-fg-subtle">
            Matches appear here, numbered so you can say “edit clip two”.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
            <AnimatePresence initial={false}>
              {clips.map((c) => (
                <ClipCard key={c.source} clip={c} active={c.id === active} edits={editCount(c.source)} spot={spotlight.includes(c.id)} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  );
}
