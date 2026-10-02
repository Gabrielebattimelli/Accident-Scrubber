#!/usr/bin/env node
// End-to-end check of every agent tool through the running app, against the live services.
//
//   npm run smoke                 # every tool except editing
//   npm run smoke -- --edit       # also renders one real fal edit (~1 min, billed) and verifies it
//
// APP_URL overrides the default http://localhost:3000.
const BASE = process.env.APP_URL || "http://localhost:3000";
const short = (s, n = 160) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : JSON.stringify(s)?.slice(0, n));

async function tool(name, args) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/tools/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  const ms = Date.now() - t0;
  console.log(`${j.ok ? "PASS" : "FAIL"} ${name} (${ms} ms)${j.ok ? "" : ` :: ${j.error}`}`);
  if (!j.ok) process.exitCode = 1;
  return j.result;
}

const search = await tool("search_archive", { query: "white truck on the highway" });
console.log(`     ${search?.hits?.length} hits; first: camera=${search?.hits?.[0]?.cameraId} loc=${search?.hits?.[0]?.location} start=${search?.hits?.[0]?.start} caption=${short(search?.hits?.[0]?.caption, 80)}`);
const hit = search?.hits?.[0];
if (!hit) {
  console.log("FAIL no search hits, cannot test the per-clip tools");
  process.exit(1);
}

const cams = await tool("list_cameras", {});
console.log(`     ${cams?.fields?.map((f) => `${f.name}(${f.values.length})`).join(", ")}`);

const askWide = await tool("ask_archive", { question: "How many trucks appear on the highway cameras?" });
console.log(`     ${short(askWide?.answer)} | ${askWide?.hits?.length} evidence clips`);
const askScoped = await tool("ask_archive", { question: "What happens?", original_video: hit.originalVideo });
console.log(`     ${short(askScoped?.answer)}`);

const look = await tool("look_closer", { source: hit.source, question: "What colour is the largest truck?" });
console.log(`     ${short(look?.answer)}`);

const det = await tool("detect_objects", { source: hit.source });
console.log(`     via=${det?.via} counts=${JSON.stringify(det?.counts)}`);

const sum = await tool("summarize_video", { original_video: hit.originalVideo });
console.log(`     ${short(sum?.answer)}`);

const v = await fetch(`${BASE}/api/video?source=${encodeURIComponent(hit.source)}`, { headers: { Range: "bytes=0-1023" } });
await v.arrayBuffer();
const vOk = v.status === 206 && v.headers.get("content-type") === "video/mp4";
console.log(`${vOk ? "PASS" : "FAIL"} /api/video range → ${v.status} ${v.headers.get("content-type")} ${v.headers.get("content-range")}`);
if (!vOk) process.exitCode = 1;

const orig = await tool("verify_clip", { source: hit.source });
console.log(`     verdict=${orig?.verdict} sha=${orig?.sha256?.slice(0, 12)}`);

if (process.argv.includes("--edit")) {
  const { edit } = (await tool("edit_clip", { source: hit.source, instruction: "make it snowing heavily", caption: hit.caption, clip_id: "1" })) || {};
  if (edit) {
    console.log(`     ${edit.id} queued on ${edit.model}; prompt sent: ${short(edit.prompt, 200)}`);
    const t0 = Date.now();
    let rec;
    while (Date.now() - t0 < 8 * 60_000) {
      await new Promise((r) => setTimeout(r, 5000));
      rec = await (await fetch(`${BASE}/api/edits/${edit.id}`)).json();
      process.stdout.write(`     [${Math.round((Date.now() - t0) / 1000)}s] ${rec.status}${rec.queuePosition !== undefined ? ` (queue ${rec.queuePosition})` : ""}${rec.pollError ? ` pollError=${rec.pollError}` : ""}\n`);
      if (rec.status === "done" || rec.status === "failed") break;
    }
    console.log(`${rec?.status === "done" ? "PASS" : "FAIL"} edit render → ${rec?.status} ${rec?.error || ""} editedSha=${rec?.editedSha256?.slice(0, 12)}`);
    if (rec?.status !== "done") process.exitCode = 1;
    if (rec?.status === "done") {
      const ver = await tool("verify_clip", { edit_id: edit.id });
      console.log(`     verdict=${ver?.verdict} intactInVast=${ver?.original?.intactInVast} matchesLedger=${ver?.edited?.matchesLedger}`);
      console.log(`     original: ${short(ver?.original?.description, 140)}`);
      console.log(`     edit:     ${short(ver?.edited?.description, 140)}`);
    }
  }
}
