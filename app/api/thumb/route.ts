import { spawn } from "node:child_process";
import type { NextRequest } from "next/server";
import { segmentStreamUrl } from "@/lib/vss";

// GET /api/thumb?source=s3://...  — one still frame (JPEG) per segment for the results reel, so the
// reel doesn't stream eight videos at once. Needs ffmpeg; the reel falls back to <video> on error.
const cache = new Map<string, Buffer>();

function grab(url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      ["-loglevel", "error", "-ss", "1", "-i", url, "-frames:v", "1", "-vf", "scale=420:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => p.kill("SIGKILL"), 30_000);
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", reject);
    p.on("close", () => {
      clearTimeout(timer);
      const jpg = Buffer.concat(chunks);
      if (jpg.length) resolve(jpg);
      else reject(new Error("no frame"));
    });
  });
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  if (!source?.startsWith("s3://")) return new Response("source must be an s3:// segment URI", { status: 400 });
  try {
    let jpg = cache.get(source);
    if (!jpg) {
      jpg = await grab(await segmentStreamUrl(source));
      if (cache.size > 300) cache.delete(cache.keys().next().value!);
      cache.set(source, jpg);
    }
    return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response(null, { status: 404 });
  }
}
