import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cosmosModel } from "./cosmos";
import { env, gpuHeaders } from "./env";
import type { Box, Det } from "./tracking";

// YOLO11 (COCO) has no forklift, AGV or robot class: it calls forklifts "truck" and AGVs "car".
// For those sites, Cosmos3-Reason grounds the machines on frames sampled at 2 fps; the boxes are
// interpolated onto every YOLO frame and replace YOLO's vehicle guesses. People stay from YOLO.

/** What to ask Cosmos to ground, per VSS location. */
export const GROUND: Record<string, string> = {
  warehouse3: "forklift",
  indoor: "humanoid robot, AGV, pallet jack",
};

const VEHICLES = new Set(["truck", "car", "bus", "motorcycle", "train"]);
const RELABEL: Record<string, string> = { warehouse3: "forklift", indoor: "agv" };

/** YOLO's COCO label, renamed to what the site actually has. */
export const relabel = (label: string, location?: string) =>
  VEHICLES.has(label) && location && RELABEL[location] ? RELABEL[location] : label;

const FPS = 2;

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`))));
  });
}

async function frames(video: Buffer): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "ground-"));
  try {
    await writeFile(path.join(dir, "c.mp4"), video);
    await ffmpeg(["-i", path.join(dir, "c.mp4"), "-vf", `fps=${FPS},scale=960:-1`, path.join(dir, "f%02d.jpg")]);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".jpg")).sort();
    return Promise.all(names.map((n) => readFile(path.join(dir, n))));
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
}

async function groundFrame(jpg: Buffer, what: string): Promise<Det[]> {
  const res = await fetch(`${env.cosmosUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...gpuHeaders() },
    body: JSON.stringify({
      model: await cosmosModel(),
      max_tokens: 400,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpg.toString("base64")}` } },
            {
              type: "text",
              text: `Detect every ${what}. Output JSON only: [{"label": ..., "bbox_2d": [x1, y1, x2, y2]}] with coordinates normalized 0-1000.`,
            },
          ],
        },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Cosmos grounding → ${res.status}`);
  const text = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "";
  const out: Det[] = [];
  for (const m of text.matchAll(/"label":\s*"([^"]+)"[^[\]]*?\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]/g)) {
    const box = [m[2], m[3], m[4], m[5]].map((v) => Math.min(1, Math.max(0, Number(v) / 1000))) as Box;
    if (box[2] > box[0] && box[3] > box[1]) out.push({ label: m[1].toLowerCase(), conf: 0.9, box });
  }
  return out;
}

/** Machine boxes sampled at 2 fps: [time, detections][]. */
export async function groundMachines(video: Buffer, location: string): Promise<[number, Det[]][]> {
  const what = GROUND[location];
  if (!what || !env.cosmosUrl) return [];
  const jpgs = await frames(video);
  const found = await Promise.all(jpgs.map((j) => groundFrame(j, what).catch(() => [] as Det[])));
  return found.map((d, k) => [(k + 0.5) / FPS, d]);
}

/** Machine boxes at time t, linearly interpolated between the two nearest samples. */
export function machinesAt(samples: [number, Det[]][], t: number): Det[] {
  if (!samples.length) return [];
  const after = samples.findIndex((s) => s[0] > t);
  if (after <= 0) return samples[after === 0 ? 0 : samples.length - 1][1];
  const [t0, a] = samples[after - 1];
  const [t1, b] = samples[after];
  if (a.length !== b.length) return t - t0 < t1 - t ? a : b;
  const k = (t - t0) / (t1 - t0);
  const sa = [...a].sort((x, y) => x.box[0] - y.box[0]);
  const sb = [...b].sort((x, y) => x.box[0] - y.box[0]);
  return sa.map((p, i) => ({ ...p, box: p.box.map((v, j) => v + (sb[i].box[j] - v) * k) as Box }));
}

export function iou(a: Box, b: Box) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}
