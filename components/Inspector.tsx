"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { fmtTime } from "@/lib/client";
import type { Clip, EditRecord, EditStatus, TrackInfo } from "@/lib/types";
import { ActivityFeed } from "./ActivityFeed";
import { colorFor } from "./DetectionOverlay";
import { store, useStore, type VerifyReport } from "./store";
import { tellAgent } from "./useAgentTools";
import { Fields, Label, PanelHeader, StatusDot, Tag, clockTime, cx, fileName, pad2, type Tone } from "./ui";

const EDIT_STATUS: Record<EditStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Rendering", tone: "info" },
  done: { label: "AI-edited", tone: "warn" },
  failed: { label: "Failed", tone: "danger" },
};

const time = (iso?: string) => (iso ? clockTime(new Date(iso).getTime()) : undefined);

function Hash({ label, value, status, tone }: { label: string; value?: string; status?: string; tone?: Tone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard needs a secure context */
    }
  };
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-fg-muted">{label}</span>
        {status && (
          <span className={cx("flex items-center gap-1.5", tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-fg-subtle")}>
            <StatusDot tone={tone || "idle"} />
            {status}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copy SHA-256"
        className="group flex w-full items-start gap-2 text-left font-mono text-[10.5px] leading-relaxed text-fg-subtle hover:text-fg-muted"
      >
        <span className="min-w-0 flex-1 break-all">{value || "—"}</span>
        {value &&
          (copied ? (
            <Check size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ok" />
          ) : (
            <Copy size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          ))}
      </button>
    </div>
  );
}

function Prose({ label, children }: { label: string; children?: string }) {
  const [open, setOpen] = useState(false);
  const long = (children?.length ?? 0) > 320;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className={cx("text-[13px] leading-relaxed text-fg-muted", long && !open && "line-clamp-6")}>{children || "—"}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-fg-subtle hover:text-fg">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Verdict({ report }: { report: VerifyReport }) {
  const r = report.raw as {
    note?: string;
    sha256?: string;
    edit?: { id: string; instruction: string; prompt: string; model: string; createdAt: string };
    original?: { sha256: string; intactInVast: boolean; description: string };
    edited?: { sha256: string; matchesLedger: boolean; description: string };
    derivedEdits?: { id: string; instruction: string; status: string }[];
  };
  const edited = report.verdict === "AI-EDITED";
  const pending = report.verdict === "PENDING";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Label>Authenticity</Label>
          <p className={cx("text-[28px] font-light leading-none tracking-tight", edited ? "text-warn" : pending ? "text-fg-muted" : "text-ok")}>
            {edited ? "AI-edited" : pending ? "Pending" : "Original"}
          </p>
          <p className="text-xs text-fg-subtle">
            {edited
              ? `Generated from archive footage by ${r.edit?.model}`
              : pending
                ? r.note
                : "Bytes served directly from the VAST archive"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close report"
          onClick={() => store.set({ verify: undefined })}
          className="rounded-md p-1 text-fg-subtle hover:bg-raised hover:text-fg"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {edited && r.original && r.edited && (
        <>
          <Fields
            rows={[
              ["Instruction", <span key="i" className="text-fg">“{r.edit?.instruction}”</span>],
              ["Edit", <span key="e" className="font-mono text-xs">{r.edit?.id}</span>],
              ["Created", <span key="c" className="font-mono text-xs">{time(r.edit?.createdAt)}</span>],
            ]}
          />
          <div className="divide-y rounded-md border">
            <Hash
              label="Original · VAST"
              value={r.original.sha256}
              status={r.original.intactInVast ? "Unchanged" : "Changed"}
              tone={r.original.intactInVast ? "ok" : "danger"}
            />
            <Hash
              label={`Edit · ${r.edit?.id}`}
              value={r.edited.sha256}
              status={r.edited.matchesLedger ? "Matches ledger" : "Mismatch"}
              tone={r.edited.matchesLedger ? "ok" : "danger"}
            />
          </div>
          <div className="space-y-4">
            <Label>What Cosmos sees</Label>
            <Prose label="Original">{r.original.description}</Prose>
            <Prose label="Edit">{r.edited.description}</Prose>
          </div>
        </>
      )}

      {!edited && !pending && (
        <>
          <div className="rounded-md border">
            <Hash label="SHA-256" value={r.sha256} status="Archive copy" tone="ok" />
          </div>
          <div className="space-y-2">
            <Label>Derived edits</Label>
            {r.derivedEdits?.length ? (
              <ul className="space-y-1.5">
                {r.derivedEdits.map((d) => (
                  <li key={d.id} className="flex gap-3 text-[13px]">
                    <span className="font-mono text-xs text-fg-subtle">{d.id}</span>
                    <span className="text-fg-muted">“{d.instruction}”</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-subtle">None. This clip has never been edited.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EditDetails({ edit, clip }: { edit: EditRecord; clip?: Clip }) {
  const st = EDIT_STATUS[edit.status];
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            Edit <span className="font-mono normal-case">{edit.id}</span>
          </Label>
          <Tag tone={st.tone}>{st.label}</Tag>
        </div>
        <p className="text-[15px] font-light leading-snug text-fg">“{edit.instruction}”</p>
      </div>
      <Prose label="Prompt sent to the model">{edit.prompt}</Prose>
      <Fields
        rows={[
          ["Model", <span key="m" className="break-all font-mono text-xs">{edit.model}</span>],
          ["Source", clip ? `Clip ${pad2(clip.id)}` : <span key="s" className="break-all font-mono text-xs">{fileName(edit.source)}</span>],
          ["Created", <span key="c" className="font-mono text-xs">{time(edit.createdAt)}</span>],
          ["Finished", edit.finishedAt ? <span key="f" className="font-mono text-xs">{time(edit.finishedAt)}</span> : undefined],
        ]}
      />
      <div className="divide-y rounded-md border">
        <Hash label="Original · VAST" value={edit.originalSha256} />
        <Hash label={`Edit · ${edit.id}`} value={edit.editedSha256} />
      </div>
      {edit.error && <p className="text-xs text-danger">{edit.error}</p>}
    </div>
  );
}

function ClipDetails({ clip }: { clip: Clip }) {
  const det = useStore((s) => s.detections[clip.id]);
  const counts = det ? Object.entries(det.counts).sort((a, b) => b[1] - a[1]) : [];
  const max = counts[0]?.[1] || 1;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Clip {pad2(clip.id)}</Label>
        {clip.score !== undefined && <span className="font-mono text-[11px] text-fg-subtle">match {clip.score.toFixed(3)}</span>}
      </div>
      <Prose label="Cosmos3-Reason caption">{clip.caption}</Prose>
      <Fields
        rows={[
          ["Camera", clip.cameraId && <span key="c" className="font-mono text-xs">{clip.cameraId}</span>],
          ["Location", clip.location && <span key="l" className="capitalize">{clip.location}</span>],
          ["Angle", clip.view],
          [
            "Segment",
            clip.start !== undefined && (
              <span key="s" className="font-mono text-xs">
                {fmtTime(clip.start)} – {fmtTime(clip.end)}
              </span>
            ),
          ],
          ["Parent video", clip.originalVideo && <span key="p" className="break-all font-mono text-[11px] text-fg-muted">{fileName(clip.originalVideo)}</span>],
          ["Segment file", <span key="f" className="break-all font-mono text-[11px] text-fg-muted">{fileName(clip.source)}</span>],
        ]}
      />
      {det && (
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <Label>Objects</Label>
            <span className="font-mono text-[10px] text-fg-faint">{det.via}</span>
          </div>
          {counts.length ? (
            <ul className="space-y-2">
              <li className="grid grid-cols-[88px_minmax(0,1fr)_44px_44px] gap-3 text-[10px] text-fg-faint">
                <span />
                <span />
                <span className="text-right">at once</span>
                <span className="text-right">tracked</span>
              </li>
              {counts.slice(0, 8).map(([label, n]) => (
                <li key={label} className="grid grid-cols-[88px_minmax(0,1fr)_44px_44px] items-center gap-3 text-xs">
                  <span className="flex items-center gap-2 truncate capitalize text-fg-muted">
                    <span className="size-2 shrink-0 rounded-[2px] ring-1 ring-fg-faint" style={{ background: colorFor(label) }} />
                    {label}
                  </span>
                  <span className="h-1 rounded-full bg-line">
                    <span className="block h-full rounded-full bg-fg-subtle" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono text-fg">{n}</span>
                  <span className="text-right font-mono text-fg-muted">{det.unique[label] ?? "—"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-subtle">No objects detected.</p>
          )}
          {det.tracks.length > 0 && <TrackList clip={clip} tracks={det.tracks} />}
        </div>
      )}
    </div>
  );
}

function TrackList({ clip, tracks }: { clip: Clip; tracks: TrackInfo[] }) {
  const [all, setAll] = useState(false);
  const focus = useStore((s) => (s.overlay.on && s.overlay.focus?.clipId === clip.id ? s.overlay.focus.id : undefined));
  const follow = (t: TrackInfo) => {
    tellAgent(focus === t.id ? `user stopped following ${t.id}` : `user is following ${t.id} in clip ${clip.id}`);
    store.set((s) => ({
      activeClipId: clip.id,
      activeEditId: undefined,
      verify: undefined,
      overlay: { on: true, labels: s.overlay.labels, focus: focus === t.id ? undefined : { clipId: clip.id, id: t.id } },
      seek: focus === t.id ? undefined : { clipId: clip.id, t: t.start, pause: false, n: Date.now() },
    }));
  };
  const shown = all ? tracks : tracks.slice(0, 8);
  return (
    <div className="space-y-1.5 pt-2">
      <p className="text-[11px] text-fg-subtle">Tracked objects · click to follow</p>
      <ul className="divide-y overflow-hidden rounded-md border">
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => follow(t)}
              aria-pressed={focus === t.id}
              title={t.motion}
              className={cx(
                "grid w-full grid-cols-[10px_76px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-raised",
                focus === t.id && "bg-raised",
              )}
            >
              <span className="size-2 rounded-[2px] ring-1 ring-fg-faint" style={{ background: colorFor(t.label) }} />
              <span className="truncate text-fg">{t.id}</span>
              <span className="truncate text-fg-subtle">{t.motion}</span>
              <span className="font-mono text-[10px] text-fg-faint">
                {t.start.toFixed(1)}–{t.end.toFixed(1)}s
              </span>
            </button>
          </li>
        ))}
      </ul>
      {tracks.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-fg-subtle hover:text-fg">
          {all ? "Show fewer" : `Show all ${tracks.length}`}
        </button>
      )}
    </div>
  );
}

export function Inspector() {
  const clips = useStore((s) => s.clips);
  const activeClipId = useStore((s) => s.activeClipId);
  const edits = useStore((s) => s.edits);
  const activeEditId = useStore((s) => s.activeEditId);
  const verify = useStore((s) => s.verify);
  const activityCount = useStore((s) => s.activity.length);

  const edit = activeEditId ? edits[activeEditId] : undefined;
  const clip = clips.find((c) => c.id === (activeClipId ?? "")) ?? (edit && clips.find((c) => c.source === edit.source));
  const ledger = Object.values(edits).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <aside className="flex min-h-[480px] min-w-0 flex-col bg-panel lg:min-h-0 lg:border-l">
      <PanelHeader title="Inspector" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b p-4">
          {verify ? (
            <Verdict report={verify} />
          ) : edit ? (
            <EditDetails edit={edit} clip={clip} />
          ) : clip ? (
            <ClipDetails clip={clip} />
          ) : (
            <div className="space-y-1.5 py-1">
              <Label>Details</Label>
              <p className="text-xs leading-relaxed text-fg-subtle">
                Clip metadata, edit provenance and authenticity reports appear here.
              </p>
            </div>
          )}
        </section>

        {ledger.length > 0 && (
          <section className="border-b p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <Label>Edit ledger</Label>
              <span className="font-mono text-[11px] text-fg-faint">{ledger.length}</span>
            </div>
            <ul className="divide-y overflow-hidden rounded-md border">
              {ledger.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() =>
                      store.set((s) => ({
                        activeEditId: e.id,
                        activeClipId: s.clips.find((c) => c.source === e.source)?.id ?? s.activeClipId,
                        verify: undefined,
                        zoom: undefined,
                      }))
                    }
                    className={cx(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-raised",
                      e.id === activeEditId && "bg-raised",
                    )}
                  >
                    <span className="w-6 font-mono text-[11px] text-fg-subtle">{e.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">{e.instruction}</span>
                    <StatusDot tone={EDIT_STATUS[e.status].tone} pulse={e.status === "queued" || e.status === "running"} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="px-4 pb-2 pt-4">
          <div className="flex items-center justify-between">
            <Label>Activity</Label>
            <span className="font-mono text-[11px] text-fg-faint">{activityCount}</span>
          </div>
          <ActivityFeed />
        </section>
      </div>
    </aside>
  );
}
