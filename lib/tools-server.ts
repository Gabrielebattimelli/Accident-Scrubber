import { askCosmos, DESCRIBE_FOR_FORENSICS } from "./cosmos";
import { clip, extractHits } from "./clips";
import { detectObjects } from "./detections";
import { submitEdit, uploadVideo } from "./edit";
import { createRecord, getRecord, recordsForSource, sha256 } from "./ledger";
import { polishEditPrompt } from "./polish";
import { fetchSegment, vss } from "./vss";

// Server-side executors for the voice agent's tools. The browser resolves spoken clip
// handles ("clip 3") to S3 sources before calling these, so everything here speaks in sources.

type Args = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function searchArchive(a: Args) {
  const query = s(a.query);
  if (!query) throw new Error("query is required");
  const metadata_filters: Record<string, string> = {};
  if (s(a.camera_id)) metadata_filters.camera_id = s(a.camera_id);
  if (s(a.location)) metadata_filters.location = s(a.location);
  const topK = Math.min(Math.max(Number(a.top_k) || 8, 1), 16);
  const data = await vss<Record<string, unknown>>("/search", {
    body: { query, top_k: topK, llm_top_n: 3, min_similarity: 0.15, metadata_filters, include_public: true },
  });
  const synth = data.llm_synthesis as { response?: string } | undefined;
  return { query, summary: clip(synth?.response, 600), hits: extractHits(data, topK) };
}

async function askArchive(a: Args) {
  const question = s(a.question);
  if (!question) throw new Error("question is required");
  const body: Args = { question, top_k: 10 };
  if (s(a.original_video)) body.original_video = s(a.original_video);
  const data = await vss<Record<string, unknown>>("/agent/ask", { body });
  return { answer: clip(s(data.answer), 1200), hits: extractHits(data, 6) };
}

async function listCameras() {
  const data = await vss<{ schema?: { name: string; options?: unknown[] }[] }>("/metadata/schema");
  const fields = (data.schema || [])
    .filter((f) => Array.isArray(f.options) && f.options.length)
    .map((f) => ({ name: f.name, values: (f.options as unknown[]).map(String).slice(0, 40) }));
  return { fields };
}

async function lookCloser(a: Args) {
  const source = s(a.source);
  const question = s(a.question) || "Describe what happens in this clip.";
  const answer = await askCosmos(await fetchSegment(source), question);
  return { answer: clip(answer, 1500) };
}

async function summarizeVideo(a: Args) {
  const original_video = s(a.original_video);
  if (!original_video) throw new Error("original_video is required");
  const data = await vss<{ answer?: string }>("/videos/synthesize", {
    body: { original_video, question: s(a.question) || "Summarize what happens in this video", max_segments: 40 },
    timeoutMs: 120_000,
  });
  return { answer: clip(data.answer, 1500) };
}

async function editClip(a: Args) {
  const source = s(a.source);
  const instruction = s(a.instruction);
  if (!source || !instruction) throw new Error("source and instruction are required");
  const original = await fetchSegment(source);
  const [videoUrl, prompt] = await Promise.all([uploadVideo(original), polishEditPrompt(instruction, s(a.caption))]);
  const { requestId, model } = await submitEdit(videoUrl, prompt);
  const edit = await createRecord({
    source,
    clipId: s(a.clip_id) || undefined,
    instruction,
    prompt,
    model,
    falRequestId: requestId,
    originalSha256: sha256(original),
    originalBytes: original.length,
    status: "queued",
  });
  return { edit };
}

async function describe(buf: Buffer) {
  try {
    return await askCosmos(buf, DESCRIBE_FOR_FORENSICS, 400);
  } catch (e) {
    return `(Cosmos unavailable: ${e instanceof Error ? e.message : e})`;
  }
}

async function verifyClip(a: Args) {
  const editId = s(a.edit_id);
  if (editId) {
    const rec = await getRecord(editId);
    if (!rec) throw new Error(`no edit ${editId} in the ledger`);
    if (rec.status !== "done" || !rec.editedUrl) return { verdict: "PENDING", note: `edit ${editId} is ${rec.status}` };
    const [original, edited] = await Promise.all([
      fetchSegment(rec.source),
      fetch(rec.editedUrl, { cache: "no-store" }).then(async (r) => Buffer.from(await r.arrayBuffer())),
    ]);
    const [origDesc, editDesc] = await Promise.all([describe(original), describe(edited)]);
    const editedHash = sha256(edited);
    return {
      verdict: "AI-EDITED",
      edit: { id: rec.id, instruction: rec.instruction, prompt: rec.prompt, model: rec.model, createdAt: rec.createdAt },
      original: { sha256: sha256(original), intactInVast: sha256(original) === rec.originalSha256, description: origDesc },
      edited: { sha256: editedHash, matchesLedger: !rec.editedSha256 || rec.editedSha256 === editedHash, description: editDesc },
    };
  }
  const source = s(a.source);
  if (!source) throw new Error("edit_id or source is required");
  const buf = await fetchSegment(source);
  const derived = await recordsForSource(source);
  return {
    verdict: "ORIGINAL",
    sha256: sha256(buf),
    note: "Bytes served straight from the VAST archive.",
    derivedEdits: derived.map((r) => ({ id: r.id, instruction: r.instruction, status: r.status, createdAt: r.createdAt })),
  };
}

export const SERVER_TOOLS: Record<string, (a: Args) => Promise<unknown>> = {
  search_archive: searchArchive,
  ask_archive: askArchive,
  list_cameras: listCameras,
  look_closer: lookCloser,
  detect_objects: (a) => detectObjects(s(a.source), () => fetchSegment(s(a.source))),
  summarize_video: summarizeVideo,
  edit_clip: editClip,
  verify_clip: verifyClip,
};

