import { downloadVideo, pollEdit } from "@/lib/edit";
import { getRecord, sha256, updateRecord } from "@/lib/ledger";

// GET /api/edits/<id>  — polls fal for an edit job and finalises the ledger record
// (hashing the edited output) once it completes.
export async function GET(_req: Request, ctx: RouteContext<"/api/edits/[id]">) {
  const { id } = await ctx.params;
  const rec = await getRecord(id);
  if (!rec) return Response.json({ error: `no edit ${id}` }, { status: 404 });
  if (rec.status === "done" || rec.status === "failed" || !rec.falRequestId) return Response.json(rec);

  try {
    const st = await pollEdit(rec.model, rec.falRequestId);
    if (st.status === "done" && st.url) {
      // A failed download throws below and leaves the record pending, so the next poll retries.
      const edited = await downloadVideo(st.url);
      const done = await updateRecord(id, {
        status: "done",
        editedUrl: st.url,
        editedSha256: sha256(edited),
        finishedAt: new Date().toISOString(),
      });
      return Response.json(done);
    }
    if (st.status === "failed") {
      return Response.json(await updateRecord(id, { status: "failed", error: st.error, finishedAt: new Date().toISOString() }));
    }
    const next = st.status !== rec.status ? await updateRecord(id, { status: st.status }) : rec;
    return Response.json({ ...next, queuePosition: st.position });
  } catch (e) {
    return Response.json({ ...rec, pollError: e instanceof Error ? e.message : String(e) });
  }
}
