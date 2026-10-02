import { env, gpuHeaders } from "./env";
import { trackFrames, type Box, type Det } from "./tracking";
import type { Detections } from "./types";
import { vss } from "./vss";

// Per-frame YOLO11 boxes for a segment, linked into tracks. Prefer the sidecar the pipeline
// already wrote (GET /videos/detections); fall back to calling YOLO11 directly on the mp4.
// Sidecar shape: { fps, video_shape: [h, w], frames: [{ time_sec, detections: [{ label, confidence, bbox: [x1,y1,x2,y2] }] }] }

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const labelOf = (o: Obj) => (o.label || o.class_name || o.name || o.class || o.cls) as string | undefined;

function parseCounts(v: unknown): Record<string, number> {
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function shapeOf(p: Obj): [number, number] | undefined {
  const s = (p.video_shape || (Array.isArray(p.frames) && (p.frames[0] as Obj)?.shape)) as unknown;
  if (Array.isArray(s) && num(s[0]) && num(s[1])) return [s[1] as number, s[0] as number]; // [h, w] → [w, h]
  const w = num(p.width);
  const h = num(p.height);
  return w && h ? [w, h] : undefined;
}

function normalize(payload: unknown): Omit<Detections, "via"> {
  const p = (payload || {}) as Obj;
  const rawFrames = Array.isArray(p.frames) ? (p.frames as Obj[]) : [];
  const fps = num(p.fps) || 30;
  const shape = shapeOf(p);

  const times: number[] = [];
  const frames: Det[][] = [];
  rawFrames.forEach((fr, i) => {
    const list = (fr.detections || fr.boxes || fr.objects) as Obj[] | undefined;
    if (!Array.isArray(list)) return;
    const dets: Det[] = [];
    for (const d of list) {
      const label = labelOf(d);
      const b = (d.bbox || d.box || d.xyxy) as number[] | undefined;
      if (!label || !Array.isArray(b) || b.length < 4) continue;
      const [x1, y1] = b;
      let [, , x2, y2] = b;
      if (x2 < x1 || y2 < y1) [x2, y2] = [x1 + x2, y1 + y2]; // x, y, w, h
      const pixels = Math.max(x1, y1, x2, y2) > 1.5;
      if (pixels && !shape) continue;
      const [w, h] = pixels && shape ? shape : [1, 1];
      const box: Box = [x1 / w, y1 / h, x2 / w, y2 / h].map((v) => Math.min(1, Math.max(0, v))) as Box;
      dets.push({ label, conf: num(d.confidence) ?? num(d.conf) ?? num(d.score) ?? 0, box });
    }
    times.push(num(fr.time_sec) ?? num(fr.timestamp) ?? (num(fr.frame_index) ?? i) / fps);
    frames.push(dets);
  });

  const aspect = shape ? shape[0] / shape[1] : 16 / 9;
  if (!frames.some((f) => f.length))
    return { aspect, counts: parseCounts(p.object_counts), unique: {}, tracks: [], times: [], frames: [] };
  return { aspect, times, ...trackFrames(frames, times, aspect) };
}

export async function detectObjects(source: string, video?: () => Promise<Buffer>): Promise<Detections> {
  try {
    const sidecar = await vss("/videos/detections", { query: { source }, timeoutMs: 30_000 });
    const d = normalize(sidecar);
    if (d.times.length || Object.keys(d.counts).length) return { via: "pipeline YOLO11 sidecar", ...d };
  } catch {
    /* 404 = no sidecar for this segment → run YOLO directly */
  }
  const empty = { aspect: 16 / 9, counts: {}, unique: {}, tracks: [], times: [], frames: [] };
  if (!env.yoloUrl || !video) return { via: "none", ...empty };
  const buf = await video();
  const res = await fetch(`${env.yoloUrl}/v1/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...gpuHeaders() },
    body: JSON.stringify({ video_base64: buf.toString("base64"), filename: "clip.mp4", include_frames: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`YOLO → ${res.status}`);
  return { via: "YOLO11 live", ...normalize(await res.json()) };
}
