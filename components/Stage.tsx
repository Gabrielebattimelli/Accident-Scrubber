"use client";

import { Film, LoaderCircle, Pause, Play, RotateCcw, ScanSearch, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtTime, videoSrc } from "@/lib/client";
import type { Clip, EditRecord } from "@/lib/types";
import { ClipReel } from "./ClipReel";
import { DetectionOverlay } from "./DetectionOverlay";
import { store, useStore } from "./store";
import { Button, PanelHeader, cx, pad2 } from "./ui";
import { loadDetections } from "./useAgentTools";

/** Header control: load YOLO tracks for the clip on first use, then toggle the box layer. */
function BoxesToggle({ clip }: { clip: Clip }) {
  const on = useStore((s) => s.overlay.on && !!s.detections[clip.id]);
  const focus = useStore((s) => (s.overlay.focus?.clipId === clip.id ? s.overlay.focus.id : undefined));
  const labels = useStore((s) => s.overlay.labels);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = async () => {
    if (on) return store.set((s) => ({ overlay: { ...s.overlay, on: false, focus: undefined } }));
    setBusy(true);
    setFailed(false);
    try {
      await loadDetections(clip);
      store.set((s) => ({ overlay: { ...s.overlay, on: true } }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {on && (focus || labels.length > 0) && (
        <button
          type="button"
          onClick={() => store.set((s) => ({ overlay: { ...s.overlay, focus: undefined, labels: [] } }))}
          className="flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs text-fg-muted hover:bg-raised"
          title="Clear filter"
        >
          {focus ? `Following ${focus}` : labels.join(", ")}
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
      <Button variant={on ? "secondary" : "ghost"} size="sm" onClick={toggle} aria-pressed={on} disabled={busy}>
        {busy ? <LoaderCircle size={13} strokeWidth={1.5} className="animate-spin" /> : <ScanSearch size={13} strokeWidth={1.5} />}
        {failed ? "Retry boxes" : "Boxes"}
      </Button>
    </>
  );
}

const span = (c?: Clip) => (c?.start !== undefined ? `${fmtTime(c.start)} – ${fmtTime(c.end)}` : undefined);

function Player({
  src,
  clipId,
  topLeft,
  topRight,
  bottomLeft,
}: {
  src: string;
  clipId?: string;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(false);
  const detections = useStore((s) => (clipId ? s.detections[clipId] : undefined));
  const overlay = useStore((s) => s.overlay);
  const seek = useStore((s) => s.seek);

  useEffect(() => {
    const v = video.current;
    if (!v || !seek || seek.clipId !== clipId) return;
    const apply = () => {
      v.currentTime = Math.min(seek.t, Math.max(0, (v.duration || Infinity) - 0.05));
      if (seek.pause) v.pause();
      else void v.play().catch(() => {});
      store.set({ seek: undefined });
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
    return () => v.removeEventListener("loadedmetadata", apply);
  }, [seek, clipId]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg border bg-black">
      <video
        ref={video}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onClick={toggle}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (bar.current && v.duration) bar.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
          if (clock.current) clock.current.textContent = `${v.currentTime.toFixed(1)}s`;
        }}
        className="h-full w-full cursor-pointer object-contain"
      />
      {detections && overlay.on && (
        <DetectionOverlay
          video={video}
          data={detections}
          labels={overlay.labels}
          focus={overlay.focus?.clipId === clipId ? overlay.focus?.id : undefined}
        />
      )}
      {topLeft && <div className="pointer-events-none absolute left-3 top-3">{topLeft}</div>}
      {topRight && <div className="pointer-events-none absolute right-3 top-3">{topRight}</div>}
      {bottomLeft && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
          {bottomLeft}
          {clipId && (
            <>
              <span className="text-white/40"> · </span>
              <span ref={clock}>0.0s</span>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={paused ? "Play" : "Pause"}
        className="absolute bottom-3 right-3 flex size-7 items-center justify-center rounded-md bg-black/70 text-white/90 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      >
        {paused ? <Play size={13} strokeWidth={1.5} /> : <Pause size={13} strokeWidth={1.5} />}
      </button>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
        <div ref={bar} className="h-full w-0 bg-white/60" />
      </div>
    </div>
  );
}

const VIDEO_TONE = { ok: "text-on-video-ok", warn: "text-on-video-warn", idle: "text-white/90" };

function VideoTag({ children, tone = "idle", className }: { children: ReactNode; tone?: keyof typeof VIDEO_TONE; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center rounded-[4px] bg-black/70 px-1.5 font-mono text-[10px] uppercase tracking-[0.06em]",
        VIDEO_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

function Elapsed({ since }: { since: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((now - start) / 1000))}s</>;
}

function RenderPane({ edit }: { edit: EditRecord }) {
  const failed = edit.status === "failed";
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-lg border bg-panel px-8 text-center">
      <span className={failed ? "text-[11px] uppercase tracking-[0.08em] text-danger" : "text-[11px] uppercase tracking-[0.08em] text-fg-subtle"}>
        {failed ? `Render failed · ${edit.id}` : `${edit.status === "queued" ? "Queued" : "Rendering"} · ${edit.id}`}
      </span>
      <p className="max-w-md text-[15px] font-light leading-snug text-fg">“{edit.instruction}”</p>
      {failed ? (
        <p className="max-w-md text-xs text-fg-subtle">{edit.error}</p>
      ) : (
        <div className="w-48">
          <div className="progress-line" />
        </div>
      )}
      <span className="font-mono text-[10px] text-fg-faint">
        {edit.model}
        {!failed && (
          <>
            {" · "}
            <Elapsed since={edit.createdAt} />
          </>
        )}
      </span>
    </div>
  );
}

function EditCompare({ clip, edit }: { clip?: Clip; edit: EditRecord }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Player
          src={videoSrc(edit.source)}
          topLeft={
            <VideoTag tone="ok">Original · VAST archive</VideoTag>
          }
          bottomLeft={span(clip)}
        />
      </div>
      <div className="space-y-2">
        {edit.status === "done" && edit.editedUrl ? (
          <Player
            src={edit.editedUrl}
            topLeft={
              <VideoTag tone="warn">AI-edited · {edit.id}</VideoTag>
            }
            topRight={
              <VideoTag tone="warn" className="tracking-[0.12em]">
                AI-EDITED
              </VideoTag>
            }
            bottomLeft={span(clip)}
          />
        ) : (
          <RenderPane edit={edit} />
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-8 text-center">
      <Film size={20} strokeWidth={1.25} className="text-fg-faint" />
      <div className="space-y-1">
        <p className="text-sm font-light text-fg">No clip on screen</p>
        <p className="max-w-sm text-xs leading-relaxed text-fg-subtle">
          Ask Hailmary for a moment, for example “find a truck changing lanes on the highway”. Results are numbered so you
          can refer to them by voice.
        </p>
      </div>
    </div>
  );
}

export function Stage() {
  const clips = useStore((s) => s.clips);
  const activeClipId = useStore((s) => s.activeClipId);
  const edits = useStore((s) => s.edits);
  const activeEditId = useStore((s) => s.activeEditId);
  const verify = useStore((s) => s.verify);
  const compare = useRef<HTMLDivElement>(null);

  const clip = clips.find((c) => c.id === activeClipId);
  const edit = activeEditId ? edits[activeEditId] : undefined;

  const replay = () =>
    compare.current?.querySelectorAll("video").forEach((v) => {
      v.currentTime = 0;
      void v.play().catch(() => {});
    });

  const title = edit ? (
    <>
      <span className="text-[13px] text-fg">Edit {edit.id}</span>
      {clip && <span className="text-[13px] text-fg-subtle">of clip {pad2(clip.id)}</span>}
    </>
  ) : clip ? (
    <>
      <span className="text-[13px] text-fg">Clip {pad2(clip.id)}</span>
      <span className="truncate font-mono text-[11px] uppercase text-fg-subtle">
        {[clip.cameraId, clip.location].filter(Boolean).join(" · ")}
      </span>
    </>
  ) : (
    "Viewer"
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <PanelHeader title={title}>
        {clip && !edit && <BoxesToggle clip={clip} />}
        {edit?.status === "done" && (
          <Button variant="ghost" size="sm" onClick={replay}>
            <RotateCcw size={13} strokeWidth={1.5} />
            Replay both
          </Button>
        )}
        {(edit || verify) && (
          <Button variant="ghost" size="sm" onClick={() => store.set({ activeEditId: undefined, verify: undefined })}>
            <X size={13} strokeWidth={1.5} />
            Close
          </Button>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={compare} className="p-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={edit ? `e-${edit.id}` : clip ? `c-${clip.id}` : "empty"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {edit ? (
                <EditCompare clip={clip} edit={edit} />
              ) : clip ? (
                <Player
                  src={videoSrc(clip.source)}
                  clipId={clip.id}
                  topLeft={<VideoTag>Clip {pad2(clip.id)}</VideoTag>}
                  topRight={
                    clip.score !== undefined && (
                      <span className="rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
                        match {clip.score.toFixed(2)}
                      </span>
                    )
                  }
                  bottomLeft={span(clip)}
                />
              ) : (
                <Empty />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <ClipReel />
      </div>
    </section>
  );
}
