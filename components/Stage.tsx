"use client";

import { Button, Card, Chip } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { fmtTime, videoSrc } from "@/lib/client";
import type { Clip, EditRecord } from "@/lib/types";
import { store, useStore, type VerifyReport } from "./store";

function Hud({ clip, label, tone = "scrub" }: { clip?: Clip; label: string; tone?: "scrub" | "authentic" }) {
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 font-mono text-xs text-white drop-shadow">
        <span className={`rec-dot inline-block h-2 w-2 rounded-full ${tone === "scrub" ? "bg-scrub" : "bg-authentic"}`} />
        {label}
      </div>
      {clip && (
        <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[11px] uppercase leading-tight text-white/85 drop-shadow">
          <div>{clip.cameraId}</div>
          <div className="text-white/60">{clip.location}</div>
        </div>
      )}
      {clip?.start !== undefined && (
        <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-white/80 drop-shadow">
          T+{fmtTime(clip.start)} – {fmtTime(clip.end)}
        </div>
      )}
    </>
  );
}

function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`scanlines relative aspect-video overflow-hidden rounded-xl border border-border bg-black ${className}`}>
      {children}
    </div>
  );
}

function EditCompare({ clip, edit }: { clip?: Clip; edit: EditRecord }) {
  const left = useRef<HTMLVideoElement>(null);
  const right = useRef<HTMLVideoElement>(null);
  const replay = () => {
    for (const v of [left.current, right.current]) {
      if (!v) continue;
      v.currentTime = 0;
      void v.play().catch(() => {});
    }
  };
  const rendering = edit.status !== "done";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Screen>
            <video ref={left} src={videoSrc(edit.source)} autoPlay muted loop playsInline className="h-full w-full object-contain" />
            <Hud clip={clip} label="ORIGINAL · VAST ARCHIVE" tone="authentic" />
          </Screen>
        </div>
        <div className="space-y-1.5">
          <Screen className={rendering ? "" : "border-scrub"}>
            {rendering ? (
              <>
                <video src={videoSrc(edit.source)} autoPlay muted loop playsInline className="h-full w-full object-contain opacity-40 blur-[2px]" />
                <div className="render-sweep" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                  <span className="font-mono text-xs uppercase tracking-[0.3em] text-scrub">
                    {edit.status === "failed" ? "Render failed" : `Rendering ${edit.id}`}
                  </span>
                  <span className="max-w-[80%] text-sm text-white/80">“{edit.instruction}”</span>
                  <span className="font-mono text-[10px] text-white/50">{edit.model}</span>
                </div>
              </>
            ) : (
              <>
                <video ref={right} src={edit.editedUrl} autoPlay muted loop playsInline className="h-full w-full object-contain" />
                <Hud clip={clip} label={`AI-EDITED · ${edit.id}`} />
                <motion.div
                  initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
                  animate={{ scale: 1, opacity: 1, rotate: -8 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="pointer-events-none absolute bottom-4 right-4 rounded-md border-2 border-scrub px-3 py-1 font-mono text-sm font-bold tracking-widest text-scrub"
                >
                  AI-EDITED
                </motion.div>
              </>
            )}
          </Screen>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip color="accent" variant="soft" size="sm">✎ {edit.instruction}</Chip>
        <Chip size="sm" variant="soft">{edit.model}</Chip>
        <Chip size="sm" variant="soft">original sha256 {edit.originalSha256.slice(0, 10)}…</Chip>
        {edit.editedSha256 && <Chip size="sm" variant="soft">edit sha256 {edit.editedSha256.slice(0, 10)}…</Chip>}
        {!rendering && (
          <Button size="sm" variant="ghost" onPress={replay}>
            ↺ Replay both
          </Button>
        )}
      </div>
    </div>
  );
}

function VerifyPanel({ report }: { report: VerifyReport }) {
  const r = report.raw as {
    original?: { sha256: string; intactInVast: boolean; description: string };
    edited?: { sha256: string; description: string };
    edit?: { instruction: string; model: string; createdAt: string };
    sha256?: string;
    derivedEdits?: { id: string; instruction: string }[];
  };
  const edited = report.verdict === "AI-EDITED";
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <Card className={`border ${edited ? "border-scrub/60" : "border-authentic/60"}`}>
        <Card.Header className="flex flex-row items-center justify-between gap-3">
          <div>
            <Card.Title className="font-mono text-xs uppercase tracking-[0.25em] text-muted">Authenticity report</Card.Title>
            <Card.Description>
              {edited
                ? `Generated ${r.edit?.createdAt ? new Date(r.edit.createdAt).toLocaleTimeString() : ""} by ${r.edit?.model}`
                : "Bytes served straight from the VAST archive"}
            </Card.Description>
          </div>
          <span
            className={`rounded-md border-2 px-3 py-1 font-mono text-lg font-black tracking-widest ${
              edited ? "border-scrub text-scrub" : "border-authentic text-authentic"
            }`}
          >
            {report.verdict}
          </span>
        </Card.Header>
        <Card.Content className="space-y-3 text-sm">
          {edited && r.original && r.edited ? (
            <>
              <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
                <div>
                  <div className="text-muted">ORIGINAL (VAST)</div>
                  <div className="break-all">{r.original.sha256}</div>
                  <div className={r.original.intactInVast ? "text-authentic" : "text-danger"}>
                    {r.original.intactInVast ? "✓ unchanged since edit" : "✗ changed"}
                  </div>
                </div>
                <div>
                  <div className="text-muted">EDIT</div>
                  <div className="break-all">{r.edited.sha256}</div>
                  <div className="text-scrub">✎ “{r.edit?.instruction}”</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[13px] leading-snug">
                <p><span className="font-mono text-[10px] text-authentic">COSMOS SAW IN ORIGINAL · </span>{r.original.description}</p>
                <p><span className="font-mono text-[10px] text-scrub">COSMOS SAW IN EDIT · </span>{r.edited.description}</p>
              </div>
            </>
          ) : (
            <div className="font-mono text-[11px]">
              <div className="break-all">sha256 {r.sha256}</div>
              <div className="text-muted">
                {r.derivedEdits?.length
                  ? `Edits derived from this clip: ${r.derivedEdits.map((d) => `${d.id} “${d.instruction}”`).join(", ")}`
                  : "No edits have been derived from this clip."}
              </div>
            </div>
          )}
        </Card.Content>
      </Card>
    </motion.div>
  );
}

export function Stage() {
  const clips = useStore((s) => s.clips);
  const activeClipId = useStore((s) => s.activeClipId);
  const edits = useStore((s) => s.edits);
  const activeEditId = useStore((s) => s.activeEditId);
  const verify = useStore((s) => s.verify);
  const detections = useStore((s) => s.detections);

  const clip = clips.find((c) => c.id === activeClipId);
  const edit = activeEditId ? edits[activeEditId] : undefined;
  const det = clip ? detections[clip.id] : undefined;

  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {edit ? (
          <motion.div key={`edit-${edit.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <EditCompare clip={clip} edit={edit} />
          </motion.div>
        ) : clip ? (
          <motion.div key={`clip-${clip.id}`} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <Screen>
              <video src={videoSrc(clip.source)} autoPlay muted loop playsInline controls className="h-full w-full object-contain" />
              <Hud clip={clip} label={`CLIP ${clip.id}`} tone="authentic" />
            </Screen>
            <div className="flex flex-wrap items-start gap-2">
              {det &&
                Object.entries(det.counts)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <Chip key={k} size="sm" variant="soft" color="accent">
                      {v} × {k}
                    </Chip>
                  ))}
              <p className="w-full text-sm leading-relaxed text-foreground/80">
                <span className="font-mono text-[10px] uppercase tracking-wider text-listen">Cosmos3-Reason · </span>
                {clip.caption || "No caption for this segment."}
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Screen className="grid-bg">
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <span className="font-mono text-sm tracking-[0.4em] text-muted">NO SIGNAL</span>
                <span className="max-w-md text-sm text-foreground/60">
                  Try: “Find a truck changing lanes on the highway” → “Edit clip one: remove the truck” → “Is that clip real?”
                </span>
              </div>
            </Screen>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{verify && <VerifyPanel key="verify" report={verify} />}</AnimatePresence>
      {(edit || verify) && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onPress={() => store.set({ activeEditId: undefined, verify: undefined })}>
            Back to clip
          </Button>
        </div>
      )}
    </div>
  );
}
