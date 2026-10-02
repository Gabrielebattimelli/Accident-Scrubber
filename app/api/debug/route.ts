import type { NextRequest } from "next/server";
import { extractHits } from "@/lib/clips";
import { vss } from "@/lib/vss";

// GET /api/debug?q=<query>            → raw VSS /search JSON + how we normalised it
// GET /api/debug?path=/metadata/schema → raw GET of any VSS /api/v1 path
// For checking response shapes on the VM. Never returns credentials. Off unless DEBUG_ROUTES=1, since it
// proxies the team's VSS session to anyone who can reach the app.
export async function GET(req: NextRequest) {
  if (process.env.DEBUG_ROUTES !== "1") return new Response(null, { status: 404 });
  const q = req.nextUrl.searchParams.get("q");
  const path = req.nextUrl.searchParams.get("path");
  if (path && (path.includes("..") || path.includes("://"))) return Response.json({ error: "bad path" }, { status: 400 });
  try {
    if (path) return Response.json(await vss(path.startsWith("/") ? path : `/${path}`));
    const raw = await vss("/search", { body: { query: q || "person close to a moving vehicle", top_k: 5, llm_top_n: 1 } });
    return Response.json({ normalised: extractHits(raw, 5), raw });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
