import { fal } from "@fal-ai/client";
import { env } from "./env";
import type { EditStatus } from "./types";

// Video-to-video editing through fal's queue API. The default model is Gemini Omni Flash 1.1
// Edit ({prompt, video_url, resolution}); any endpoint with the same {prompt, video_url}
// contract can be swapped in with FAL_EDIT_MODEL.

let configured = false;
function client() {
  if (!env.falKey) throw new Error("FAL_KEY is not set");
  if (!configured) {
    fal.config({ credentials: env.falKey });
    configured = true;
  }
  return fal;
}

export async function uploadVideo(buf: Buffer): Promise<string> {
  const blob = new Blob([new Uint8Array(buf)], { type: "video/mp4" });
  return client().storage.upload(blob);
}

function buildInput(model: string, videoUrl: string, prompt: string): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt, video_url: videoUrl };
  if (model.includes("gemini-omni")) input.resolution = env.editResolution;
  if (env.editExtra) {
    try {
      Object.assign(input, JSON.parse(env.editExtra));
    } catch {
      /* ignore malformed FAL_EDIT_EXTRA_JSON */
    }
  }
  return input;
}

/** Download a finished edit from fal's CDN (for hashing / Cosmos). */
export async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`edited video download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("edited video download returned 0 bytes");
  return buf;
}

export async function submitEdit(videoUrl: string, prompt: string, model = env.editModel) {
  const queued = await client().queue.submit(model, { input: buildInput(model, videoUrl, prompt) });
  return { requestId: queued.request_id, model };
}

export async function pollEdit(
  model: string,
  requestId: string,
): Promise<{ status: EditStatus; url?: string; position?: number; error?: string }> {
  const f = client();
  const s = await f.queue.status(model, { requestId, logs: false });
  if (s.status === "IN_QUEUE") return { status: "queued", position: s.queue_position };
  if (s.status === "IN_PROGRESS") return { status: "running" };
  try {
    const result = await f.queue.result(model, { requestId });
    const data = result.data as { video?: { url?: string }; videos?: { url?: string }[] };
    const url = data.video?.url || data.videos?.[0]?.url;
    return url ? { status: "done", url } : { status: "failed", error: "edit model returned no video" };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
