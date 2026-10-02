import { vss } from "./vss";

// BM25 keyword search over every segment caption, used when VSS /search is down. /search needs the
// shared Cosmos-Embed1 service for every query; /videos/explore only reads VastDB, so this keeps
// working when the embedder isn't.

type Seg = Record<string, unknown> & { reasoning_content?: string; location?: string };
type Row = { seg: Seg; tf: Map<string, number>; len: number };
type Catalog = { at: number; rows: Row[]; df: Map<string, number>; avg: number };

const STOP = new Set(
  "the and for with from that this into onto near show find someone something any are was were has have its their there where which while what when who".split(" "),
);
const SYN: Record<string, string[]> = {
  person: ["person", "individual", "man", "woman", "pedestrian", "worker", "people"],
  people: ["people", "person", "individual", "pedestrian", "worker"],
  car: ["car", "vehicle", "suv", "sedan"],
  robot: ["robot", "humanoid"],
  bike: ["bike", "bicycle", "cyclist"],
  cyclist: ["cyclist", "bicycle", "bike"],
};

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokens = (t?: string) => (t?.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

const g = globalThis as unknown as { __captionCatalog?: Promise<Catalog> & { at?: number } };

async function build(): Promise<Catalog> {
  const rows: Row[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await vss<{ chunks?: (Seg & { timeline?: Seg[] })[] }>("/videos/explore", {
      query: { scope: "all", limit: 100, offset, indexed: "partial" },
    });
    for (const ch of page.chunks || []) {
      for (const seg of ch.timeline || []) {
        const toks = tokens(seg.reasoning_content);
        const tf = new Map<string, number>();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        rows.push({
          seg: { ...seg, camera_id: ch.camera_id, location: ch.location, upload_timestamp: ch.upload_timestamp, original_video: ch.original_video },
          tf,
          len: toks.length || 1,
        });
      }
    }
    if ((page.chunks || []).length < 100) break;
  }
  const df = new Map<string, number>();
  for (const r of rows) for (const t of r.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  return { at: Date.now(), rows, df, avg: rows.reduce((n, r) => n + r.len, 0) / Math.max(rows.length, 1) };
}

async function catalog(): Promise<Catalog> {
  const cur = g.__captionCatalog;
  if (cur && Date.now() - (cur.at ?? 0) < 10 * 60_000) return cur;
  const next = build() as Promise<Catalog> & { at?: number };
  next.at = Date.now();
  g.__captionCatalog = next;
  next.catch(() => {
    if (g.__captionCatalog === next) g.__captionCatalog = undefined;
  });
  return next;
}

export async function captionSearch(query: string, topK: number, filters: Record<string, string> = {}) {
  const cat = await catalog();
  const n = Math.max(cat.rows.length, 1);
  const groups = [...new Set(tokens(query))].map((t) => SYN[t] || [t]);
  const idf = groups.map((grp) => {
    const d = Math.min(grp.reduce((s, t) => s + (cat.df.get(t) || 0), 0), n);
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  });
  const best = idf.reduce((s, i) => s + i * 2.2, 0) || 1;
  const scored: [number, Seg][] = [];
  for (const r of cat.rows) {
    if (filters.location && r.seg.location !== filters.location) continue;
    if (filters.camera_id && r.seg.camera_id !== filters.camera_id) continue;
    const norm = 1.2 * (0.25 + (0.75 * r.len) / cat.avg);
    let s = 0;
    groups.forEach((grp, i) => {
      const f = grp.reduce((a, t) => a + (r.tf.get(t) || 0), 0);
      if (f) s += (idf[i] * f * 2.2) / (f + norm);
    });
    if (s > 0) scored.push([s / best, r.seg]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return { results: scored.slice(0, topK).map(([s, seg]) => ({ ...seg, similarity_score: Math.round((0.2 + 0.6 * Math.min(s, 1)) * 1000) / 1000 })) };
}
