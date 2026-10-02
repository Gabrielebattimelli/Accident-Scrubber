"use client";

import { ChevronsLeftRight, Columns2, Film, LoaderCircle, Pause, Play, RotateCcw, ScanSearch, X, ZoomOut } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { callTool, fmtTime, videoSrc } from "@/lib/client";
import type { Clip, EditRecord } from "@/lib/types";
import { Board } from "./Board";
import { ClipReel } from "./ClipReel";
import { DetectionOverlay, boxOf, pictureRect } from "./DetectionOverlay";
import { store, useStore, type Note } from "./store";
import { Timeline } from "./Timeline";
import { Button, PanelHeader, cx, pad2 } from "./ui";
import { loadDetections, tellAgent } from "./useAgentTools";

/** Header control: load YOLO tracks for the clip on first use, then toggle the box layer. */
function BoxesToggle({ clip }: { clip: Clip }) {
  const on = useStore((s) => s.overlay.on && !!s.detections[clip.id]);
  const focus = useStore((s) => (s.overlay.focus?.clipId === clip.id ? s.overlay.focus.id : undefined));
  const labels = useStore((s) => s.overlay.labels);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = async () => {
    if (on) {
      tellAgent("user hid the boxes");
      return store.set((s) => ({ overlay: { ...s.overlay, on: false, focus: undefined } }));
    }
    setBusy(true);
    setFailed(false);
    try {
      const s = store.get();
      const others = s.layout.mode === "single" ? [] : s.clips.filter((c) => c.id !== clip.id && (s.layout as { clipIds: string[] }).clipIds.includes(c.id));
      await loadDetections(clip);
      store.set((s) => ({ overlay: { ...s.overlay, on: true } }));
      tellAgent(`user turned on the boxes for clip ${clip.id}`);
      others.forEach((c) => void loadDetections(c).catch(() => {}));
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
const NO_NOTES: Note[] = [];

/**
 * One video with its box/notes layer. `main` players obey the agent's play/pause and speed; zoom
 * transforms the video and its overlay together and, when following an object, tracks it each frame.
 */
function Player({
  src,
  clipId,
  topLeft,
  topRight,
  bottomLeft,
  main,
  boxes = true,
  videoRef,
  onSelect,
  className,
}: {
  src: string;
  clipId?: string;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  main?: boolean;
  boxes?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onSelect?: () => void;
  className?: string;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? own;
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(false);
  const detections = useStore((s) => (clipId ? s.detections[clipId] : undefined));
  const overlay = useStore((s) => s.overlay);
  const seek = useStore((s) => s.seek);
  const rate = useStore((s) => s.rate);
  const play = useStore((s) => s.play);
  const zoom = useStore((s) => (clipId && s.zoom?.clipId === clipId ? s.zoom : undefined));
  const allNotes = useStore((s) => (clipId ? s.notes : NO_NOTES));
  const notes = useMemo(() => allNotes.filter((n) => n.clipId === clipId), [allNotes, clipId]);

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
  }, [seek, clipId, video]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
  }, [rate, src, video]);

  useEffect(() => {
    const v = video.current;
    if (!main || !v || !play) return;
    if (play.paused) v.pause();
    else void v.play().catch(() => {});
    store.set({ play: undefined });
  }, [play, main, video]);

  // Zoom: translate so the target sits in the middle, clamped to the picture; ease toward it.
  useEffect(() => {
    const el = inner.current;
    const box = frame.current;
    if (!el || !box) return;
    if (!zoom) {
      el.style.transform = "";
      return;
    }
    let raf = 0;
    let cx = -1;
    let cy = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v) return;
      const W = box.clientWidth;
      const H = box.clientHeight;
      const { ox, oy, cw, ch } = pictureRect(v, W, H, detections?.aspect);
      let fx = zoom.x;
      let fy = zoom.y;
      const b = zoom.object && detections ? boxOf(detections, zoom.object, v.currentTime) : undefined;
      if (b) {
        fx = (b[1] + b[3]) / 2;
        fy = (b[2] + b[4]) / 2;
      }
      const tx = ox + fx * cw;
      const ty = oy + fy * ch;
      cx = cx < 0 ? tx : cx + (tx - cx) * 0.12;
      cy = cy < 0 ? ty : cy + (ty - cy) * 0.12;
      const s = zoom.scale;
      const x = Math.min(0, Math.max(W - W * s, W / 2 - cx * s));
      const y = Math.min(0, Math.max(H - H * s, H / 2 - cy * s));
      el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [zoom, detections, video]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (onSelect) return onSelect();
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };
  const showBoxes = boxes && overlay.on && !!detections;
  return (
    <div ref={frame} className={cx("group relative aspect-video overflow-hidden rounded-lg border bg-black", className)}>
      <div ref={inner} className="absolute inset-0 origin-top-left will-change-transform">
        <video
          ref={video}
          src={src}
          data-sync
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
        {(showBoxes || notes.length > 0) && (
          <DetectionOverlay
            video={video}
            data={detections}
            boxes={showBoxes}
            labels={overlay.labels}
            focus={overlay.focus?.clipId === clipId ? overlay.focus?.id : undefined}
            notes={notes}
          />
        )}
      </div>
      {topLeft && <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">{topLeft}</div>}
      {topRight && <div className="pointer-events-none absolute right-3 top-3 flex gap-1.5">{topRight}</div>}
      {zoom && (
        <div className="pointer-events-none absolute right-3 top-10">
          <VideoTag tone="warn">
            {zoom.scale.toFixed(1)}x{zoom.object ? ` · ${zoom.object}` : ""}
          </VideoTag>
        </div>
      )}
      {main && <CaptionBar />}
      {bottomLeft && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
          {bottomLeft}
          {clipId && (
            <>
              <span className="text-white/40"> · </span>
              <span ref={clock}>0.0s</span>
              {main && rate !== 1 && <span className="text-on-video-warn"> · {rate}x</span>}
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          const v = video.current;
          if (!v) return;
          if (v.paused) void v.play().catch(() => {});
          else v.pause();
        }}
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

/** Lower-third caption the agent writes over the main video. */
function CaptionBar() {
  const caption = useStore((s) => s.caption);
  return (
    <AnimatePresence>
      {caption && (
        <motion.div
          key={caption}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-x-6 bottom-10 flex justify-center"
        >
          <p className="max-w-[90%] rounded-md bg-black/80 px-3 py-1.5 text-center text-[15px] font-light leading-snug text-white">
            <span className="mr-2 inline-block h-3 w-[3px] translate-y-px bg-[#ff5a1f]" />
            {caption}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Keep every [data-sync] video in a container on the first one's clock (Sightline's sync loop). */
function useSync(container: RefObject<HTMLDivElement | null>, key: string) {
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const vids = container.current?.querySelectorAll<HTMLVideoElement>("video[data-sync]");
      if (!vids || vids.length < 2) return;
      const [m, ...rest] = vids;
      for (const v of rest) {
        if (v.readyState < 1) continue;
        const dur = v.duration || Infinity;
        const target = Math.min(m.currentTime, dur - 0.05);
        if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
        if (m.paused !== v.paused) {
          if (m.paused) v.pause();
          else void v.play().catch(() => {});
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [container, key]);
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

/** Before/after wipe: original underneath, the edit on top clipped at the handle. Drag to compare. */
function BeforeAfter({ clip, edit }: { clip?: Clip; edit: EditRecord }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);
  useSync(wrap, edit.id);
  const move = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      ref={wrap}
      className="relative aspect-video touch-none select-none overflow-hidden rounded-lg border bg-black"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
      }}
      tabIndex={0}
      role="slider"
      aria-label="Before and after"
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <video src={videoSrc(edit.source)} data-sync autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-contain" />
      <video
        src={edit.editedUrl}
        data-sync
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 h-full w-full object-contain"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      />
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_12px_rgb(0_0_0/0.5)]" />
        <div className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ChevronsLeftRight size={16} strokeWidth={1.75} />
        </div>
      </div>
      <div className="pointer-events-none absolute left-3 top-3">
        <VideoTag tone="ok">Before · original in VAST</VideoTag>
      </div>
      <div className="pointer-events-none absolute right-3 top-3">
        <VideoTag tone="warn" className="tracking-[0.12em]">
          After · AI-EDITED {edit.id}
        </VideoTag>
      </div>
      {clip && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
          {span(clip)} · drag to compare
        </div>
      )}
    </div>
  );
}

function EditCompare({ clip, edit }: { clip?: Clip; edit: EditRecord }) {
  const view = useStore((s) => s.editView);
  const wrap = useRef<HTMLDivElement>(null);
  useSync(wrap, `${edit.id}${view}`);
  if (edit.status === "done" && edit.editedUrl && view === "slider") return <BeforeAfter clip={clip} edit={edit} />;
  return (
    <div ref={wrap} className="grid gap-3 md:grid-cols-2">
      <Player src={videoSrc(edit.source)} clipId={clip?.id} main topLeft={<VideoTag tone="ok">Original · VAST archive</VideoTag>} bottomLeft={span(clip)} />
      {edit.status === "done" && edit.editedUrl ? (
        <Player
          src={edit.editedUrl}
          topLeft={<VideoTag tone="warn">AI-edited · {edit.id}</VideoTag>}
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
  );
}

/** Two clips side by side on one clock: another camera on the same moment, or any two results. */
function Compare({ clips, title }: { clips: Clip[]; title?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  useSync(wrap, clips.map((c) => c.id).join());
  return (
    <div className="space-y-2">
      {title && <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-subtle">{title} · synced playback</p>}
      <div ref={wrap} className="grid gap-3 md:grid-cols-2">
        {clips.map((c, i) => (
          <Player
            key={c.id}
            src={videoSrc(c.source)}
            clipId={c.id}
            main={i === 0}
            topLeft={
              <>
                <VideoTag>Clip {pad2(c.id)}</VideoTag>
                {c.view && <VideoTag tone="ok">{c.view}</VideoTag>}
              </>
            }
            bottomLeft={c.cameraId || span(c)}
          />
        ))}
      </div>
    </div>
  );
}

/** A wall of clips, all playing. Click one to open it. */
function Grid({ clips }: { clips: Clip[] }) {
  const open = (c: Clip) => {
    store.set({ activeClipId: c.id, layout: { mode: "single" } });
    tellAgent(`user opened clip ${c.id} from the grid`);
  };
  return (
    <div className={cx("grid gap-2", clips.length <= 4 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3")}>
      {clips.map((c) => (
        <Player
          key={c.id}
          src={videoSrc(c.source)}
          clipId={c.id}
          onSelect={() => open(c)}
          topLeft={<VideoTag>Clip {pad2(c.id)}</VideoTag>}
          bottomLeft={[c.cameraId, c.view].filter(Boolean).join(" · ") || span(c)}
        />
      ))}
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
          Ask Raccoon for a moment, for example “find a truck changing lanes on the highway”. Results are numbered so you
          can refer to them by voice.
        </p>
      </div>
    </div>
  );
}

/** The single-clip view: player, then Sightline's object timeline. */
function Single({ clip }: { clip: Clip }) {
  const video = useRef<HTMLVideoElement>(null);
  const detections = useStore((s) => s.detections[clip.id]);
  return (
    <div>
      <Player
        src={videoSrc(clip.source)}
        clipId={clip.id}
        main
        videoRef={video}
        topLeft={
          <>
            <VideoTag>Clip {pad2(clip.id)}</VideoTag>
            {clip.view && <VideoTag tone="ok">{clip.view}</VideoTag>}
          </>
        }
        topRight={
          clip.score !== undefined && (
            <span className="rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/70">match {clip.score.toFixed(2)}</span>
          )
        }
        bottomLeft={span(clip)}
      />
      <Timeline video={video} clipId={clip.id} data={detections} />
    </div>
  );
}

export function Stage() {
  const clips = useStore((s) => s.clips);
  const activeClipId = useStore((s) => s.activeClipId);
  const edits = useStore((s) => s.edits);
  const activeEditId = useStore((s) => s.activeEditId);
  const verify = useStore((s) => s.verify);
  const layout = useStore((s) => s.layout);
  const editView = useStore((s) => s.editView);
  const zoom = useStore((s) => s.zoom);
  const compare = useRef<HTMLDivElement>(null);

  const clip = clips.find((c) => c.id === activeClipId);
  const edit = activeEditId ? edits[activeEditId] : undefined;
  const group = layout.mode === "single" || edit ? [] : layout.clipIds.map((id) => clips.find((c) => c.id === id)).filter((c): c is Clip => !!c);
  const mode = edit ? "edit" : group.length > 1 ? layout.mode : clip ? "single" : "empty";

  const replay = () =>
    compare.current?.querySelectorAll("video").forEach((v) => {
      v.currentTime = 0;
      void v.play().catch(() => {});
    });

  const title =
    mode === "edit" && edit ? (
      <>
        <span className="text-[13px] text-fg">Edit {edit.id}</span>
        {clip && <span className="text-[13px] text-fg-subtle">of clip {pad2(clip.id)}</span>}
      </>
    ) : mode === "grid" ? (
      <span className="text-[13px] text-fg">Grid · {group.length} clips</span>
    ) : mode === "compare" ? (
      <span className="text-[13px] text-fg">Clips {group.map((c) => pad2(c.id)).join(" + ")}</span>
    ) : clip ? (
      <>
        <span className="text-[13px] text-fg">Clip {pad2(clip.id)}</span>
        <span className="truncate font-mono text-[11px] uppercase text-fg-subtle">{[clip.cameraId, clip.view, clip.location].filter(Boolean).join(" · ")}</span>
      </>
    ) : (
      "Viewer"
    );

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <PanelHeader title={title}>
        {zoom && (
          <Button variant="ghost" size="sm" onClick={() => store.set({ zoom: undefined })}>
            <ZoomOut size={13} strokeWidth={1.5} />
            Reset zoom
          </Button>
        )}
        {mode === "single" && clip && <AngleButton clip={clip} />}
        {(mode === "single" || mode === "compare" || mode === "grid") && clip && <BoxesToggle clip={clip} />}
        {edit?.status === "done" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => store.set({ editView: editView === "slider" ? "split" : "slider" })}
              title="Switch between the wipe slider and side by side"
            >
              {editView === "slider" ? <Columns2 size={13} strokeWidth={1.5} /> : <ChevronsLeftRight size={13} strokeWidth={1.5} />}
              {editView === "slider" ? "Side by side" : "Slider"}
            </Button>
            <Button variant="ghost" size="sm" onClick={replay}>
              <RotateCcw size={13} strokeWidth={1.5} />
              Replay
            </Button>
          </>
        )}
        {(edit || verify || mode === "grid" || mode === "compare") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => store.set({ activeEditId: undefined, verify: undefined, layout: { mode: "single" } })}
          >
            <X size={13} strokeWidth={1.5} />
            Close
          </Button>
        )}
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={compare} className="p-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode === "edit" && edit ? `e-${edit.id}` : mode === "single" && clip ? `c-${clip.id}` : `${mode}-${group.map((c) => c.id).join()}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {mode === "edit" && edit ? (
                <EditCompare clip={clip} edit={edit} />
              ) : mode === "grid" ? (
                <Grid clips={group} />
              ) : mode === "compare" ? (
                <Compare clips={group} title={layout.mode === "compare" ? layout.title : undefined} />
              ) : clip ? (
                <Single clip={clip} />
              ) : (
                <Empty />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <Board />
        <ClipReel />
      </div>
    </section>
  );
}

/** Header control: find this moment on another camera of the same scene. */
function AngleButton({ clip }: { clip: Clip }) {
  const [busy, setBusy] = useState(false);
  const [none, setNone] = useState(false);
  if (!clip.view) return null;
  const go = async () => {
    setBusy(true);
    setNone(false);
    try {
      const r = await callTool<{ other: Omit<Clip, "id"> | null }>("compare_angles", {
        source: clip.source,
        location: clip.location,
        query: store.get().lastQuery || clip.caption?.slice(0, 200),
      });
      if (!r.other) return setNone(true);
      const s = store.get();
      const known = s.clips.find((c) => c.source === r.other!.source);
      const other = known || { ...r.other, id: String(s.nextClip) };
      store.set({
        clips: known ? s.clips : [...s.clips, other],
        nextClip: known ? s.nextClip : s.nextClip + 1,
        layout: { mode: "compare", clipIds: [clip.id, other.id], title: "Same moment · two cameras" },
      });
      tellAgent(`user opened another camera angle: clip ${clip.id} and clip ${other.id} side by side`);
    } catch {
      setNone(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={go} disabled={busy}>
      {busy ? <LoaderCircle size={13} strokeWidth={1.5} className="animate-spin" /> : <Columns2 size={13} strokeWidth={1.5} />}
      {none ? "No other angle" : "Other angle"}
    </Button>
  );
}
