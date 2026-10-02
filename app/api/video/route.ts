import type { NextRequest } from "next/server";
import { segmentStreamUrl, vssToken } from "@/lib/vss";

// GET /api/video?source=s3://...  — same-origin, seekable proxy for VSS segment playback.
// Keeps the VSS JWT server-side and avoids mixed-content issues behind a tunnel.
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  if (!source) return new Response("source is required", { status: 400 });

  const range = req.headers.get("range");
  const call = async () =>
    fetch(await segmentStreamUrl(source), { headers: range ? { Range: range } : {}, cache: "no-store" });

  let upstream = await call();
  if (upstream.status === 401) {
    await vssToken(true);
    upstream = await call();
  }
  const headers = new Headers({ "Cache-Control": "private, max-age=300" });
  for (const h of PASS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  return new Response(upstream.body, { status: upstream.status, headers });
}
