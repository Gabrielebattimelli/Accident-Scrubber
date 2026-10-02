import type { ClipHit } from "./types";

// The VSS search/agent responses carry segment rows whose exact field names vary a little
// between endpoints (results[] vs chunk_results[] vs evidence). Normalise them defensively.

type Row = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v.length ? v : undefined);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

function first<T>(row: Row, keys: string[], conv: (v: unknown) => T | undefined): T | undefined {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Row;
  for (const k of keys) {
    const v = conv(row[k]) ?? conv(meta[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function normalizeHit(row: Row): ClipHit | null {
  const source = first(row, ["source", "preview_source", "segment_source", "s3_uri"], str);
  if (!source) return null;
  return {
    source,
    originalVideo: first(row, ["original_video", "parent_video", "chunk_source"], str),
    cameraId: first(row, ["camera_id", "camera"], str),
    location: first(row, ["location", "site"], str),
    start: first(row, ["best_match_start_sec", "segment_start_sec", "start_sec", "start_time", "t_start", "start"], num),
    end: first(row, ["best_match_end_sec", "segment_end_sec", "end_sec", "end_time", "t_end", "end"], num),
    score: first(row, ["similarity_score", "score", "similarity"], num),
    caption: first(row, ["reasoning_content", "caption", "description", "text"], str),
  };
}

/** Pull every segment-like row out of an arbitrary VSS response, deduped by source. */
export function extractHits(payload: unknown, limit = 12): ClipHit[] {
  const out = new Map<string, ClipHit>();
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 4 || out.size >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const hit = normalizeHit(node as Row);
    if (hit && !out.has(hit.source)) out.set(hit.source, hit);
    for (const v of Object.values(node as Row)) if (v && typeof v === "object") visit(v, depth + 1);
  };
  const p = (payload || {}) as Row;
  // Prefer exact-moment rows, then grouped chunk rows, then anything else (agent evidence).
  visit(p.results, 0);
  visit(p.chunk_results, 0);
  visit(p.evidence, 0);
  if (out.size === 0) visit(p, 0);
  return [...out.values()].slice(0, limit);
}

export const clip = (s: string | undefined, n: number) =>
  s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
