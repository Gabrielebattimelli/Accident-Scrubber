import { SERVER_TOOLS } from "@/lib/tools-server";

// POST /api/tools/<name>  — executes one voice-agent tool server-side.
export async function POST(req: Request, ctx: RouteContext<"/api/tools/[name]">) {
  const { name } = await ctx.params;
  const tool = SERVER_TOOLS[name];
  if (!tool) return Response.json({ error: `unknown tool ${name}` }, { status: 404 });
  const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t0 = Date.now();
  try {
    const result = await tool(args);
    return Response.json({ ok: true, ms: Date.now() - t0, result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[tool ${name}]`, error);
    return Response.json({ ok: false, ms: Date.now() - t0, error }, { status: 502 });
  }
}
