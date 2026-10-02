import { env, gpuHeaders } from "./env";
import { vss } from "./vss";

// Object counts for a segment. Prefer the YOLO sidecar the pipeline already wrote
// (GET /videos/detections); fall back to calling YOLO11 directly on the mp4.

type Counts = Record<string, number>;

function countLabels(payload: unknown): { counts: Counts; frames: number } {
  const p = (payload || {}) as Record<string, unknown>;
  if (p.object_counts && typeof p.object_counts === "object") {
    return { counts: p.object_counts as Counts, frames: Array.isArray(p.frames) ? p.frames.length : 0 };
  }
  // Generic walk: every frame-like array of boxes → max count per label across frames.
  const max: Counts = {};
  let frames = 0;
  const labelOf = (o: Record<string, unknown>) =>
    (o.class_name || o.label || o.name || o.class || o.cls) as string | undefined;
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      const labels = node
        .filter((x) => x && typeof x === "object")
        .map((x) => labelOf(x as Record<string, unknown>))
        .filter((l): l is string => typeof l === "string");
      if (labels.length) {
        frames++;
        const local: Counts = {};
        for (const l of labels) local[l] = (local[l] || 0) + 1;
        for (const [l, n] of Object.entries(local)) max[l] = Math.max(max[l] || 0, n);
      }
      for (const x of node) if (x && typeof x === "object") visit(x, depth + 1);
      return;
    }
    if (typeof node === "object") for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(payload, 0);
  return { counts: max, frames };
}

export async function detectObjects(source: string, video?: () => Promise<Buffer>) {
  try {
    const sidecar = await vss("/videos/detections", { query: { source }, timeoutMs: 30_000 });
    const { counts, frames } = countLabels(sidecar);
    if (Object.keys(counts).length) return { via: "pipeline YOLO11 sidecar", counts, frames };
  } catch {
    /* 404 = no sidecar for this segment → run YOLO directly */
  }
  if (!env.yoloUrl || !video) return { via: "none", counts: {}, frames: 0 };
  const buf = await video();
  const res = await fetch(`${env.yoloUrl}/v1/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...gpuHeaders() },
    body: JSON.stringify({ video_base64: buf.toString("base64"), filename: "clip.mp4", include_frames: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`YOLO → ${res.status}`);
  const { counts, frames } = countLabels(await res.json());
  return { via: "YOLO11 live", counts, frames };
}
