"use client";

import { useConversationClientTool } from "@elevenlabs/react";
import { BASE, callTool, fmtTime } from "@/lib/client";
import type { Clip, ClipHit, EditRecord } from "@/lib/types";
import { nextId, store, type VerifyReport } from "./store";

// Client tools for the ElevenLabs agent. The agent speaks in short handles ("clip 3", "e1");
// these handlers resolve them to archive sources, call /api/tools/*, update the screen,
// and return a compact text result the LLM can read aloud.

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const short = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || "");

let notify: (text: string) => void = () => {};
export const setNotifier = (fn: (text: string) => void) => {
  notify = fn;
};

function resolveClip(id: unknown): Clip {
  const s = store.get();
  const n = str(id).match(/\d+/)?.[0];
  const clip = n ? s.clips.find((c) => c.id === n) : s.clips.find((c) => c.id === s.activeClipId);
  if (!clip) throw new Error(n ? `there is no clip ${n} on screen` : "no clip is on screen yet, search first");
  return clip;
}

function resolveEdit(id: unknown): EditRecord {
  const s = store.get();
  const n = str(id).match(/\d+/)?.[0];
  const key = n ? `e${n}` : s.activeEditId;
  const edit = key ? s.edits[key] : undefined;
  if (!edit) throw new Error(n ? `there is no edit e${n}` : "no edit has been made yet");
  return edit;
}

/** Merge hits into the reel (new ones get the next spoken numbers) and return them in rank order. */
function addClips(hits: ClipHit[]): Clip[] {
  const s = store.get();
  const bySource = new Map(s.clips.map((c) => [c.source, c]));
  let n = s.nextClip;
  const ranked = hits.map((h) => bySource.get(h.source) || { ...h, id: String(n++) });
  const rest = s.clips.filter((c) => !ranked.includes(c));
  store.set({ clips: [...ranked, ...rest], nextClip: n });
  return ranked;
}

const describe = (c: Clip) =>
  `clip ${c.id} (${[c.cameraId, c.location, c.start !== undefined ? `at ${fmtTime(c.start)}` : ""]
    .filter(Boolean)
    .join(", ")}): ${short(c.caption, 170)}`;

/** Run a tool with an entry in the activity feed. Errors become a spoken-friendly string. */
async function track(tool: string, label: string, fn: () => Promise<string>): Promise<string> {
  const id = nextId();
  const t0 = performance.now();
  store.set((s) => ({ activity: [{ id, tool, label, status: "running" as const }, ...s.activity].slice(0, 30) }));
  const finish = (status: "done" | "error", detail: string) =>
    store.set((s) => ({
      activity: s.activity.map((a) =>
        a.id === id ? { ...a, status, detail, ms: Math.round(performance.now() - t0) } : a,
      ),
    }));
  try {
    const out = await fn();
    finish("done", short(out, 140));
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finish("error", msg);
    return `TOOL ERROR: ${msg}`;
  }
}

function pollEdit(id: string) {
  const started = Date.now();
  const tick = async () => {
    try {
      const rec = (await (await fetch(`${BASE}/api/edits/${id}`)).json()) as EditRecord;
      store.set((s) => ({ edits: { ...s.edits, [id]: rec } }));
      if (rec.status === "done") {
        store.set({ activeEditId: id, activeClipId: store.get().clips.find((c) => c.source === rec.source)?.id });
        notify(`[system notice] Edit ${id} is ready ("${rec.instruction}"). It is on screen next to the original. Tell the user in one sentence.`);
        return;
      }
      if (rec.status === "failed") {
        notify(`[system notice] Edit ${id} failed: ${rec.error}. Tell the user briefly and offer to retry with a simpler instruction.`);
        return;
      }
    } catch {
      /* transient — keep polling */
    }
    if (Date.now() - started < 8 * 60_000) setTimeout(tick, 4000);
  };
  setTimeout(tick, 4000);
}

export function useAgentTools() {
  useConversationClientTool("search_archive", (p: P) =>
    track("search_archive", `Search · “${str(p.query)}”`, async () => {
      const query = str(p.query);
      store.set({ lastQuery: query });
      const r = await callTool<{ summary?: string; hits: ClipHit[] }>("search_archive", {
        query,
        top_k: p.top_k,
        camera_id: p.camera_id,
        location: p.location,
      });
      const clips = addClips(r.hits);
      if (!clips.length) return "No matching clips. Try a different visual description.";
      store.set({ activeClipId: clips[0].id, activeEditId: undefined, verify: undefined });
      return (
        `Found ${clips.length} clips, best first. Clip ${clips[0].id} is already on screen. ` +
        clips.map(describe).join(" | ") +
        (r.summary ? ` || Archive summary: ${r.summary}` : "")
      );
    }),
  );

  useConversationClientTool("ask_archive", (p: P) =>
    track("ask_archive", `Ask · “${short(str(p.question), 60)}”`, async () => {
      const clip = str(p.clip_id) ? resolveClip(p.clip_id) : undefined;
      const r = await callTool<{ answer: string; hits: ClipHit[] }>("ask_archive", {
        question: str(p.question),
        original_video: clip?.originalVideo,
      });
      const clips = addClips(r.hits);
      if (clips[0] && !store.get().activeClipId) store.set({ activeClipId: clips[0].id });
      return `${r.answer}${clips.length ? ` || Evidence on screen: ${clips.map(describe).join(" | ")}` : ""}`;
    }),
  );

  useConversationClientTool("list_cameras", () =>
    track("list_cameras", "List cameras & sites", async () => {
      const r = await callTool<{ fields: { name: string; values: string[] }[] }>("list_cameras", {});
      return r.fields.map((f) => `${f.name}: ${f.values.join(", ")}`).join(" | ") || "No filterable fields.";
    }),
  );

  useConversationClientTool("show_clip", (p: P) =>
    track("show_clip", "Show on screen", async () => {
      if (str(p.edit_id)) {
        const edit = resolveEdit(p.edit_id);
        const clip = store.get().clips.find((c) => c.source === edit.source);
        store.set({ activeEditId: edit.id, activeClipId: clip?.id, verify: undefined });
        return edit.status === "done"
          ? `Edit ${edit.id} is on screen beside the original.`
          : `Edit ${edit.id} is still ${edit.status}; the original is on screen.`;
      }
      const clip = resolveClip(p.clip_id);
      store.set({ activeClipId: clip.id, activeEditId: undefined, verify: undefined });
      return `Clip ${clip.id} is on screen. ${describe(clip)}`;
    }),
  );

  useConversationClientTool("look_closer", (p: P) =>
    track("look_closer", `Cosmos · “${short(str(p.question), 60)}”`, async () => {
      const clip = resolveClip(p.clip_id);
      store.set({ activeClipId: clip.id });
      const r = await callTool<{ answer: string }>("look_closer", { source: clip.source, question: str(p.question) });
      return `Cosmos watched clip ${clip.id}: ${r.answer}`;
    }),
  );

  useConversationClientTool("detect_objects", (p: P) =>
    track("detect_objects", "YOLO11 · count objects", async () => {
      const clip = resolveClip(p.clip_id);
      const r = await callTool<{ via: string; counts: Record<string, number> }>("detect_objects", {
        source: clip.source,
      });
      store.set((s) => ({ detections: { ...s.detections, [clip.id]: r } }));
      const list = Object.entries(r.counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      return list ? `Clip ${clip.id} (${r.via}), max per frame: ${list}.` : `No objects detected in clip ${clip.id}.`;
    }),
  );

  useConversationClientTool("summarize_video", (p: P) =>
    track("summarize_video", "Summarise parent video", async () => {
      const clip = resolveClip(p.clip_id);
      if (!clip.originalVideo) throw new Error(`clip ${clip.id} has no parent video reference`);
      const r = await callTool<{ answer: string }>("summarize_video", {
        original_video: clip.originalVideo,
        question: str(p.question) || undefined,
      });
      return r.answer;
    }),
  );

  useConversationClientTool("edit_clip", (p: P) =>
    track("edit_clip", `Edit · “${short(str(p.instruction), 60)}”`, async () => {
      const clip = resolveClip(p.clip_id);
      const { edit } = await callTool<{ edit: EditRecord }>("edit_clip", {
        source: clip.source,
        instruction: str(p.instruction),
        caption: clip.caption,
        clip_id: clip.id,
      });
      store.set((s) => ({
        edits: { ...s.edits, [edit.id]: edit },
        activeEditId: edit.id,
        activeClipId: clip.id,
        verify: undefined,
      }));
      pollEdit(edit.id);
      return `Edit ${edit.id} of clip ${clip.id} is rendering on ${edit.model}. Instruction sent: "${edit.prompt}". It takes about a minute; a [system notice] will arrive when it is ready.`;
    }),
  );

  useConversationClientTool("check_edit", (p: P) =>
    track("check_edit", "Check edit status", async () => {
      const edit = resolveEdit(p.edit_id);
      return `Edit ${edit.id} is ${edit.status}${edit.error ? `: ${edit.error}` : ""}.`;
    }),
  );

  useConversationClientTool("verify_clip", (p: P) =>
    track("verify_clip", "Verify authenticity", async () => {
      const s = store.get();
      const wantsEdit = str(p.edit_id) || (!str(p.clip_id) && s.activeEditId);
      if (wantsEdit) {
        const edit = resolveEdit(p.edit_id);
        const r = await callTool<Record<string, unknown>>("verify_clip", { edit_id: edit.id });
        store.set({ verify: { verdict: r.verdict as VerifyReport["verdict"], editId: edit.id, raw: r }, activeEditId: edit.id });
        if (r.verdict !== "AI-EDITED") return `Edit ${edit.id} is not finished yet.`;
        const o = r.original as { intactInVast: boolean; description: string; sha256: string };
        const e = r.edited as { description: string; sha256: string };
        return (
          `VERDICT: AI-EDITED. Edit ${edit.id} was generated from archive footage with the instruction "${edit.instruction}". ` +
          `The original in VAST is ${o.intactInVast ? "intact" : "CHANGED"} (fingerprint ${o.sha256.slice(0, 8)}; edit ${e.sha256.slice(0, 8)}). ` +
          `Original shows: ${short(o.description, 400)} || Edit shows: ${short(e.description, 400)}`
        );
      }
      const clip = resolveClip(p.clip_id);
      const r = await callTool<{ sha256: string; derivedEdits: { id: string; instruction: string }[] }>("verify_clip", {
        source: clip.source,
      });
      store.set({ verify: { verdict: "ORIGINAL", clipId: clip.id, raw: r }, activeClipId: clip.id, activeEditId: undefined });
      return (
        `VERDICT: ORIGINAL. Clip ${clip.id} is untouched archive footage (fingerprint ${r.sha256.slice(0, 8)}).` +
        (r.derivedEdits.length
          ? ` Edits made from it: ${r.derivedEdits.map((d) => `${d.id} ("${d.instruction}")`).join(", ")}.`
          : " No edits have been made from it.")
      );
    }),
  );
}
