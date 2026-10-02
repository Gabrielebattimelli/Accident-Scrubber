"use client";

import { useConversationClientTool } from "@elevenlabs/react";
import { BASE, callTool, fmtTime } from "@/lib/client";
import type { Clip, ClipHit, Detections, EditRecord } from "@/lib/types";
import { nextId, store, type Card, type Layout, type State, type VerifyReport } from "./store";

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

// Silent context for the agent when the user changes the screen by hand ("user opened clip 3").
let context: (text: string) => void = () => {};
export const setContextSink = (fn: (text: string) => void) => {
  context = fn;
};
export const tellAgent = (text: string) => context(`[screen] ${text}`);

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

/** Add one clip to the end of the reel (if new) without reordering it. */
function appendClip(hit: ClipHit): Clip {
  const s = store.get();
  const known = s.clips.find((c) => c.source === hit.source);
  if (known) return known;
  const clip = { ...hit, id: String(s.nextClip) };
  store.set({ clips: [...s.clips, clip], nextClip: s.nextClip + 1 });
  return clip;
}

const describe = (c: Clip) =>
  `clip ${c.id} (${[c.cameraId, c.location, c.start !== undefined ? `at ${fmtTime(c.start)}` : ""]
    .filter(Boolean)
    .join(", ")}): ${short(c.caption, 170)}`;

/** YOLO11 tracks for a clip, fetched once per clip. */
export async function loadDetections(clip: Clip): Promise<Detections> {
  const cached = store.get().detections[clip.id];
  if (cached) return cached;
  const r = await callTool<Detections>("detect_objects", { source: clip.source, location: clip.location });
  store.set((s) => ({ detections: { ...s.detections, [clip.id]: r } }));
  return r;
}

/** Make sure the clip is visible: keep a grid/compare layout that already contains it. */
function putOnScreen(clip: Clip) {
  const s = store.get();
  const inLayout = s.layout.mode !== "single" && s.layout.clipIds.includes(clip.id);
  if (s.activeClipId !== clip.id || s.activeEditId || s.verify || (s.layout.mode !== "single" && !inLayout))
    store.set({ activeClipId: clip.id, activeEditId: undefined, verify: undefined, ...(inLayout ? {} : { layout: SINGLE }) });
}

const SINGLE: Layout = { mode: "single" };

/** "1, 3 and 4" → clips on screen. */
function resolveClips(v: unknown): Clip[] {
  const ids = str(v).match(/\d+/g) || [];
  return ids.map((n) => resolveClip(n));
}

/** "top left" / "center" / "0.3, 0.6" → a point in 0–1 frame coordinates. */
function parsePoint(v: unknown): [number, number] | undefined {
  const t = str(v).toLowerCase();
  if (!t) return undefined;
  const nums = t.match(/\d*\.?\d+/g);
  if (nums && nums.length >= 2) {
    const [x, y] = nums.map(Number).map((n) => (n > 1 ? n / 100 : n));
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }
  const x = /left/.test(t) ? 0.25 : /right/.test(t) ? 0.75 : 0.5;
  const y = /top|upper/.test(t) ? 0.25 : /bottom|lower/.test(t) ? 0.75 : 0.5;
  return [x, y];
}

/** Find a tracked object ("truck 2", "the forklift") in a clip's detections. */
async function resolveTrack(clip: Clip, v: unknown) {
  const d = await loadDetections(clip);
  const want = str(v).toLowerCase().replace(/^the\s+/, "");
  const [, word = "", num = "1"] = want.match(/^([a-z ]*?)\s*#?(\d+)?$/) || [];
  const id = `${singular(word.trim())} ${num}`;
  const t = d.tracks.find((x) => x.id === id);
  if (!t) {
    const same = d.tracks.filter((x) => x.label === singular(word.trim())).map((x) => x.id);
    throw new Error(`no ${id} in clip ${clip.id}${same.length ? `; tracked: ${same.join(", ")}` : d.tracks.length ? `; tracked: ${d.tracks.slice(0, 10).map((x) => x.id).join(", ")}` : ""}`);
  }
  return t;
}

/** "a | b; c" or newlines → list items. */
const items = (v: unknown) =>
  str(v)
    .split(/\s*(?:\||;|\n)\s*/)
    .map((x) => x.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);

/** "Cars: 4; Trucks = 2" → [["Cars","4"],["Trucks","2"]]. */
const pairs = (v: unknown) =>
  str(v)
    .split(/\s*(?:\||;|,(?![^(]*\))|\n)\s*/)
    .map((x) => x.match(/^(.+?)\s*[:=]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1].trim(), m[2].trim()] as [string, string]);

let cardSeq = 0;

/** A short description of everything on screen, for the agent. */
export function describeScreen() {
  const s = store.get();
  const clip = s.clips.find((c) => c.id === s.activeClipId);
  const edit = s.activeEditId ? s.edits[s.activeEditId] : undefined;
  const parts: string[] = [];
  if (!s.clips.length) return "Nothing on screen yet: no search has been run.";
  parts.push(`${s.clips.length} clips in the results reel${s.lastQuery ? ` for "${s.lastQuery}"` : ""}.`);
  if (s.verify) parts.push(`An authenticity report (${s.verify.verdict}) is open.`);
  if (edit) parts.push(`Edit ${edit.id} (${edit.status}, "${edit.instruction}") is shown as a before/after ${s.editView}.`);
  else if (s.layout.mode === "grid") parts.push(`A grid of clips ${s.layout.clipIds.join(", ")} is on screen.`);
  else if (s.layout.mode === "compare") parts.push(`Clips ${s.layout.clipIds.join(" and ")} are side by side, in sync.`);
  else if (clip) parts.push(`Main viewer: ${describe(clip)}.`);
  if (s.overlay.on) parts.push(`Boxes on${s.overlay.labels.length ? ` (${s.overlay.labels.join(", ")} only)` : ""}${s.overlay.focus ? `, following ${s.overlay.focus.id}` : ""}.`);
  if (s.zoom) parts.push(`Zoomed ${s.zoom.scale.toFixed(1)}x${s.zoom.object ? ` on ${s.zoom.object}` : ""}.`);
  if (s.rate !== 1) parts.push(`Playing at ${s.rate}x.`);
  if (s.notes.length) parts.push(`Notes: ${s.notes.map((n) => `"${n.text}"`).join(", ")}.`);
  if (s.caption) parts.push(`Caption: "${s.caption}".`);
  if (s.markers.length) parts.push(`Timeline marks: ${s.markers.map((m) => `${m.t}s ${m.label}`).join(", ")}.`);
  if (s.cards.length) parts.push(`Cards on the board: ${s.cards.map((c) => `${c.id} "${c.title}"`).join(", ")}.`);
  const edits = Object.values(s.edits);
  if (edits.length) parts.push(`Edits: ${edits.map((e) => `${e.id} ${e.status}`).join(", ")}.`);
  return parts.join(" ");
}

const singular = (w: string) =>
  w === "people" || w === "persons"
    ? "person"
    : w.endsWith("buses")
      ? w.slice(0, -2)
      : w.endsWith("s") && !/(bus|ss)$/.test(w)
        ? w.slice(0, -1)
        : w;

/** "trucks, buses" → ["truck", "bus"]; "all" → []. */
const parseLabels = (v: unknown) =>
  str(v)
    .toLowerCase()
    .split(/[,;/]|\band\b/)
    .map((w) => singular(w.trim()))
    .filter((w) => w && w !== "all" && w !== "everything");

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : w.endsWith("s") ? "es" : "s"}`;

function trackSummary(clip: Clip, d: Detections, labels: string[] = []) {
  const unique = Object.entries(d.unique).filter(([l]) => !labels.length || labels.includes(l));
  if (!unique.length) return `No tracked objects${labels.length ? ` of type ${labels.join(", ")}` : ""} in clip ${clip.id}.`;
  const atOnce = Object.entries(d.counts)
    .filter(([l]) => !labels.length || labels.includes(l))
    .map(([l, n]) => plural(n, l))
    .join(", ");
  const tracks = d.tracks.filter((t) => !labels.length || labels.includes(t.label));
  const listed = tracks
    .slice(0, 14)
    .map((t) => `${t.id} ${t.start}–${t.end}s ${t.motion}`)
    .join("; ");
  return (
    `Clip ${clip.id} (${d.via}): ${unique.map(([l, n]) => plural(n, l)).join(", ")} tracked; most at once: ${atOnce}. ` +
    `Objects: ${listed}${tracks.length > 14 ? `; and ${tracks.length - 14} more` : ""}.`
  );
}

/** "2.5", "0:03", "3s" → seconds. */
function parseTime(v: unknown) {
  const s = str(v).replace(/s(ec(onds?)?)?$/i, "");
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  const t = m ? Number(m[1]) * 60 + Number(m[2]) : Number(s);
  if (!Number.isFinite(t) || t < 0) throw new Error(`"${str(v)}" is not a time in seconds`);
  return t;
}

const falsy = (v: unknown) => v === false || /^(false|no|off|0|hide)$/i.test(str(v));

let seekN = 0;
const seekTo = (clipId: string, t: number, pause: boolean) => store.set({ seek: { clipId, t, pause, n: ++seekN } });

/** Run a tool with an entry in the activity feed. Errors become a spoken-friendly string. */
async function track(tool: string, label: string, fn: () => Promise<string>): Promise<string> {
  const id = nextId();
  const t0 = performance.now();
  store.set((s) => ({ activity: [{ id, at: Date.now(), tool, label, status: "running" as const }, ...s.activity].slice(0, 50) }));
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
      store.set({ activeClipId: clips[0].id, activeEditId: undefined, verify: undefined, layout: SINGLE, zoom: undefined, spotlight: [] });
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
        const editView = /split|side/i.test(str(p.style)) ? "split" : /slider|wipe/i.test(str(p.style)) ? "slider" : store.get().editView;
        store.set({ activeEditId: edit.id, activeClipId: clip?.id, verify: undefined, layout: SINGLE, zoom: undefined, editView });
        return edit.status === "done"
          ? `Edit ${edit.id} is on screen as a before/after ${editView === "slider" ? "slider (drag to wipe between original and edit)" : "side by side"}.`
          : `Edit ${edit.id} is still ${edit.status}; the original is on screen.`;
      }
      const clip = resolveClip(p.clip_id);
      store.set({ activeClipId: clip.id, activeEditId: undefined, verify: undefined, layout: SINGLE, zoom: undefined });
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
    track("detect_objects", "YOLO11 · detect & track", async () => {
      const clip = resolveClip(p.clip_id);
      const d = await loadDetections(clip);
      const labels = parseLabels(p.labels);
      putOnScreen(clip);
      store.set({ overlay: { on: true, labels, focus: undefined } });
      return `${trackSummary(clip, d, labels)} Boxes are drawn on screen.`;
    }),
  );

  useConversationClientTool("show_detections", (p: P) =>
    track("show_detections", falsy(p.visible) ? "Hide boxes" : "Show boxes", async () => {
      const clip = resolveClip(p.clip_id);
      if (falsy(p.visible)) {
        store.set((s) => ({ overlay: { ...s.overlay, on: false, focus: undefined } }));
        return "Boxes hidden.";
      }
      const d = await loadDetections(clip);
      const labels = parseLabels(p.labels);
      const known = new Set(d.tracks.map((t) => t.label));
      const missing = labels.filter((l) => !known.has(l));
      putOnScreen(clip);
      store.set((s) => ({ overlay: { on: true, labels, focus: labels.length ? undefined : s.overlay.focus } }));
      return (
        (missing.length ? `No ${missing.join(", ")} detected in clip ${clip.id}. ` : "") +
        `Showing ${labels.length ? labels.join(", ") : "all"} boxes. ${trackSummary(clip, d, labels)}`
      );
    }),
  );

  useConversationClientTool("focus_object", (p: P) =>
    track("focus_object", `Follow · ${str(p.object) || "none"}`, async () => {
      const clip = resolveClip(p.clip_id);
      const want = str(p.object).toLowerCase();
      if (!want || /^(none|clear|nothing|all)$/.test(want)) {
        store.set((s) => ({ overlay: { ...s.overlay, focus: undefined } }));
        return "Focus cleared.";
      }
      const d = await loadDetections(clip);
      const [, word = "", num = "1"] = want.match(/^([a-z ]*?)\s*#?(\d+)?$/) || [];
      const id = `${singular(word.trim())} ${num}`;
      const t = d.tracks.find((x) => x.id === id);
      if (!t) {
        const same = d.tracks.filter((x) => x.label === singular(word.trim())).map((x) => x.id);
        throw new Error(`no ${id} in clip ${clip.id}${same.length ? `; tracked: ${same.join(", ")}` : ""}`);
      }
      putOnScreen(clip);
      store.set((s) => ({ overlay: { on: true, labels: s.overlay.labels, focus: { clipId: clip.id, id: t.id } } }));
      seekTo(clip.id, t.start, false);
      return `${t.id} is highlighted with its path, playing from ${t.start}s. On screen ${t.start}–${t.end}s, ${t.motion}, confidence ${Math.round(t.conf * 100)}%.`;
    }),
  );

  useConversationClientTool("seek_clip", (p: P) =>
    track("seek_clip", `Seek · ${str(p.time)}s`, async () => {
      const clip = resolveClip(p.clip_id);
      const length = clip.start !== undefined && clip.end !== undefined ? clip.end - clip.start : undefined;
      const t = Math.min(parseTime(p.time), length ? Math.max(0, length - 0.05) : Infinity);
      const pause = !falsy(p.pause);
      putOnScreen(clip);
      seekTo(clip.id, t, pause);
      const visible = store.get().detections[clip.id];
      const at = visible?.frames[visible.times.findLastIndex((x) => x <= t)]
        ?.map((b) => visible.tracks[b[0]].id)
        .join(", ");
      return `Clip ${clip.id} ${pause ? "paused" : "playing"} at ${t.toFixed(1)}s.${at ? ` Tracked objects in this frame: ${at}.` : ""}`;
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
        seconds: clip.start !== undefined && clip.end !== undefined ? clip.end - clip.start : undefined,
      });
      store.set((s) => ({
        edits: { ...s.edits, [edit.id]: edit },
        activeEditId: edit.id,
        activeClipId: clip.id,
        layout: SINGLE,
        zoom: undefined,
        verify: undefined,
      }));
      pollEdit(edit.id);
      return `Edit ${edit.id} of clip ${clip.id} is rendering on ${edit.model}. Instruction sent: "${edit.prompt}". It takes 20 to 75 seconds; a [system notice] will arrive when it is ready.`;
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

  // ---- Screen control: the agent decides what the user sees ----

  useConversationClientTool("get_screen", () => track("get_screen", "Read the screen", async () => describeScreen()));

  useConversationClientTool("compare_angles", (p: P) =>
    track("compare_angles", "Other camera · same moment", async () => {
      const clip = resolveClip(p.clip_id);
      const r = await callTool<{ other: ClipHit | null; reason?: string }>("compare_angles", {
        source: clip.source,
        location: clip.location,
        query: store.get().lastQuery || clip.caption?.slice(0, 200),
      });
      if (!r.other) return `No other camera angle of clip ${clip.id}: ${r.reason || "not found"}.`;
      const other = appendClip(r.other);
      store.set({
        activeClipId: clip.id,
        activeEditId: undefined,
        verify: undefined,
        zoom: undefined,
        layout: { mode: "compare", clipIds: [clip.id, other.id], title: "Same moment · two cameras" },
      });
      if (store.get().overlay.on) void loadDetections(other).catch(() => {});
      return `Clip ${clip.id} (${clip.view || clip.cameraId}) and clip ${other.id} (${other.view || other.cameraId}) are side by side, playing in sync. ${describe(other)}`;
    }),
  );

  useConversationClientTool("set_layout", (p: P) =>
    track("set_layout", `Layout · ${str(p.mode) || "single"}`, async () => {
      const mode = str(p.mode).toLowerCase();
      const s = store.get();
      if (/grid|wall|all/.test(mode)) {
        const picked = str(p.clips) ? resolveClips(p.clips) : s.clips.slice(0, 4);
        if (!picked.length) throw new Error("no clips on screen yet, search first");
        const ids = picked.slice(0, 9).map((c) => c.id);
        store.set({ layout: { mode: "grid", clipIds: ids }, activeClipId: ids[0], activeEditId: undefined, verify: undefined, zoom: undefined });
        return `Grid of clips ${ids.join(", ")} on screen, all playing.`;
      }
      if (/compare|side|split|versus|vs/.test(mode)) {
        const picked = resolveClips(p.clips);
        const pair = picked.length >= 2 ? picked.slice(0, 2) : [resolveClip(undefined), picked[0]].filter(Boolean);
        if (pair.length < 2 || pair[0].id === pair[1].id) throw new Error("name two different clips to compare, e.g. clips \"1, 3\"");
        store.set({
          layout: { mode: "compare", clipIds: [pair[0].id, pair[1].id], title: str(p.title) || undefined },
          activeClipId: pair[0].id,
          activeEditId: undefined,
          verify: undefined,
          zoom: undefined,
        });
        return `Clips ${pair[0].id} and ${pair[1].id} side by side, in sync.`;
      }
      const clip = resolveClip(str(p.clips) || undefined);
      store.set({ layout: SINGLE, activeClipId: clip.id, activeEditId: undefined, verify: undefined });
      return `Single view: clip ${clip.id}.`;
    }),
  );

  useConversationClientTool("playback", (p: P) =>
    track("playback", `Playback · ${str(p.action) || `${str(p.speed)}x`}`, async () => {
      const clip = resolveClip(undefined);
      const action = str(p.action).toLowerCase();
      const speed = Number(str(p.speed).replace(/x$/i, ""));
      const out: string[] = [];
      if (Number.isFinite(speed) && speed > 0) {
        const rate = Math.min(4, Math.max(0.1, speed));
        store.set({ rate });
        out.push(rate === 1 ? "normal speed" : `${rate}x speed`);
      } else if (/slow/.test(action)) {
        store.set({ rate: 0.25 });
        out.push("slow motion, 0.25x");
      } else if (/normal|real/.test(action)) {
        store.set({ rate: 1 });
        out.push("normal speed");
      }
      if (/restart|replay|beginning|start over/.test(action)) {
        seekTo(clip.id, 0, false);
        out.push("restarted");
      } else if (/pause|stop|freeze|hold/.test(action)) {
        store.set({ play: { paused: true, n: ++seekN } });
        out.push("paused");
      } else if (/play|resume|go/.test(action)) {
        store.set({ play: { paused: false, n: ++seekN } });
        out.push("playing");
      }
      return out.length ? `Video ${out.join(", ")}.` : "Nothing changed: say play, pause, restart, slow or a speed like 0.5.";
    }),
  );

  useConversationClientTool("zoom", (p: P) =>
    track("zoom", `Zoom · ${str(p.object) || str(p.region) || "reset"}`, async () => {
      const clip = resolveClip(p.clip_id);
      const level = Math.min(6, Math.max(1, Number(str(p.level).replace(/x$/i, "")) || 2.5));
      if (/^(reset|off|none|out|clear)$/i.test(str(p.object) || str(p.region)) || level <= 1 || (!str(p.object) && !str(p.region))) {
        store.set({ zoom: undefined });
        return "Zoom reset to the full frame.";
      }
      putOnScreen(clip);
      if (str(p.object)) {
        const t = await resolveTrack(clip, p.object);
        store.set((s) => ({ zoom: { clipId: clip.id, scale: level, object: t.id, x: 0.5, y: 0.5 }, overlay: { ...s.overlay, on: true } }));
        seekTo(clip.id, t.start, false);
        return `Zoomed ${level}x on ${t.id}; the camera follows it from ${t.start}s.`;
      }
      const [x, y] = parsePoint(p.region) || [0.5, 0.5];
      store.set({ zoom: { clipId: clip.id, scale: level, x, y } });
      return `Zoomed ${level}x into the ${str(p.region)} of clip ${clip.id}.`;
    }),
  );

  useConversationClientTool("annotate", (p: P) =>
    track("annotate", `Note · “${short(str(p.text), 40)}”`, async () => {
      const clip = resolveClip(p.clip_id);
      const text = short(str(p.text), 80);
      if (!text) throw new Error("text is required");
      putOnScreen(clip);
      const from = str(p.from) ? parseTime(p.from) : undefined;
      const to = str(p.to) ? parseTime(p.to) : undefined;
      if (str(p.object)) {
        const t = await resolveTrack(clip, p.object);
        store.set((s) => ({ notes: [...s.notes, { id: nextId(), clipId: clip.id, text, object: t.id, from, to }].slice(-8), overlay: { ...s.overlay, on: true } }));
        return `Note "${text}" pinned to ${t.id}; it follows the object.`;
      }
      const [x, y] = parsePoint(p.position) || [0.5, 0.2];
      store.set((s) => ({ notes: [...s.notes, { id: nextId(), clipId: clip.id, text, x, y, from, to }].slice(-8) }));
      return `Note "${text}" placed on clip ${clip.id}.`;
    }),
  );

  useConversationClientTool("set_caption", (p: P) =>
    track("set_caption", str(p.text) ? `Caption · “${short(str(p.text), 40)}”` : "Clear caption", async () => {
      const text = short(str(p.text), 140);
      store.set({ caption: text || undefined });
      return text ? "Caption shown across the bottom of the video." : "Caption cleared.";
    }),
  );

  useConversationClientTool("mark_moment", (p: P) =>
    track("mark_moment", `Mark · ${str(p.time)}s ${short(str(p.label), 30)}`, async () => {
      const clip = resolveClip(p.clip_id);
      const t = parseTime(p.time);
      const label = short(str(p.label) || "moment", 40);
      putOnScreen(clip);
      store.set((s) => ({ markers: [...s.markers.filter((m) => !(m.clipId === clip.id && Math.abs(m.t - t) < 0.05)), { id: nextId(), clipId: clip.id, t, label }] }));
      return `Marked ${t}s "${label}" on the timeline of clip ${clip.id}. The user can click it to jump there.`;
    }),
  );

  useConversationClientTool("show_card", (p: P) =>
    track("show_card", `Card · “${short(str(p.title), 40)}”`, async () => {
      const title = short(str(p.title), 80);
      if (!title) throw new Error("title is required");
      const tone = (["finding", "warning", "ok"] as const).find((t) => str(p.tone).toLowerCase().startsWith(t.slice(0, 4))) || "note";
      const clips = str(p.clips) ? resolveClips(p.clips).map((c) => c.id) : undefined;
      const s = store.get();
      const moments = items(p.moments)
        .map((m) => m.match(/^(\d+(?:\.\d+)?)\s*s?\s*[-–:]?\s*(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => [Number(m[1]), m[2] || "moment"] as [number, string]);
      const bars = pairs(p.chart)
        .map(([k, v]) => [k, Number(v.replace(/[^\d.-]/g, ""))] as [string, number])
        .filter(([, v]) => Number.isFinite(v));
      const replace = str(p.replace).match(/\d+/)?.[0];
      const id = replace && s.cards.some((c) => c.id === `card ${replace}`) ? `card ${replace}` : `card ${++cardSeq}`;
      const card: Card = {
        id,
        at: Date.now(),
        title,
        tone,
        body: short(str(p.body), 600) || undefined,
        stats: pairs(p.stats).slice(0, 6),
        bars: bars.slice(0, 10),
        bullets: items(p.bullets).slice(0, 8),
        clips,
        moments: moments.slice(0, 8),
        clipId: moments.length ? resolveClip(p.clip_id).id : undefined,
      };
      store.set((st) => ({
        cards: [card, ...st.cards.filter((c) => c.id !== id)].slice(0, 6),
        spotlight: clips?.length ? clips : st.spotlight,
      }));
      return `${id} "${title}" is on the board${clips?.length ? `; clips ${clips.join(", ")} are highlighted in the reel` : ""}.`;
    }),
  );

  useConversationClientTool("clear_screen", (p: P) =>
    track("clear_screen", `Clear · ${str(p.what) || "all"}`, async () => {
      const what = str(p.what).toLowerCase() || "all";
      const all = /all|every/.test(what);
      const patch: Partial<State> = {};
      const cleared: string[] = [];
      const card = what.match(/card\s*(\d+)/)?.[1];
      if (card) {
        store.set((s) => ({ cards: s.cards.filter((c) => c.id !== `card ${card}`) }));
        return `Removed card ${card}.`;
      }
      const clear = (re: RegExp, name: string, p: Partial<State>) => {
        if (!all && !re.test(what)) return;
        Object.assign(patch, p);
        cleared.push(name);
      };
      clear(/card|board/, "cards", { cards: [], spotlight: [] });
      clear(/note|annot|label/, "notes", { notes: [] });
      clear(/caption/, "caption", { caption: undefined });
      clear(/mark|timeline/, "timeline marks", { markers: [] });
      clear(/zoom/, "zoom", { zoom: undefined });
      clear(/box|detect/, "boxes", { overlay: { on: false, labels: [] } });
      clear(/layout|grid|compare/, "layout", { layout: SINGLE });
      if (all) Object.assign(patch, { rate: 1, verify: undefined, activeEditId: undefined });
      store.set(patch);
      return cleared.length ? `Cleared ${cleared.join(", ")}.` : `Nothing called "${what}" to clear.`;
    }),
  );
}
