import type { NextRequest } from "next/server";
import { segmentStreamUrl, vssToken } from "@/lib/vss";

// GET /api/video?source=s3://...  — same-origin, seekable proxy for VSS segment playback.
// Keeps the VSS JWT server-side and avoids mixed-content issues behind a tunnel.
const PASS = ["content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  if (!source?.startsWith("s3://")) return new Response("source must be an s3:// segment URI", { status: 400 });

  const range = req.headers.get("range");
  const call = async () =>
    fetch(await segmentStreamUrl(source), {
      headers: range ? { Range: range } : {},
      cache: "no-store",
      signal: req.signal,
    });

  try {
    let upstream = await call();
    if (upstream.status === 401) {
      await upstream.body?.cancel();
      await vssToken(true);
      upstream = await call();
    }
    if (!upstream.ok) {
      const text = (await upstream.text()).slice(0, 200);
      const status = upstream.status === 404 || upstream.status === 416 ? upstream.status : 502;
      return new Response(`VSS stream ${upstream.status}: ${text}`, { status });
    }
    const headers = new Headers({ "Cache-Control": "private, max-age=300" });
    for (const h of PASS) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    // VSS serves segments as binary/octet-stream; <video> needs a real media type.
    const type = upstream.headers.get("content-type");
    headers.set("content-type", type?.startsWith("video/") ? type : "video/mp4");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 204 });
    console.error("[video]", e);
    return new Response(`video proxy failed: ${e instanceof Error ? e.message : e}`, { status: 502 });
  }
}
