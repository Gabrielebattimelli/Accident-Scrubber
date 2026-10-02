import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EditRecord } from "./types";

// Provenance ledger: every AI edit is recorded with the SHA-256 of the original segment
// (as stored in VAST) and of the edited output. File-backed so it is shared across route
// bundles and survives restarts.

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "ledger.json");

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

async function load(): Promise<EditRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  // A corrupt ledger must fail loudly: treating it as empty would overwrite the provenance trail.
  return JSON.parse(text) as EditRecord[];
}

// Route bundles get separate module instances, so the read-modify-write lock lives on globalThis.
const g = globalThis as typeof globalThis & { __ledgerLock?: Promise<unknown> };
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__ledgerLock ?? Promise.resolve()).then(fn, fn);
  g.__ledgerLock = run.catch(() => {});
  return run;
}

async function save(records: EditRecord[]) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2));
  await fs.rename(tmp, FILE);
}

export function createRecord(r: Omit<EditRecord, "id" | "createdAt">): Promise<EditRecord> {
  return locked(async () => {
    const records = await load();
    const rec: EditRecord = { ...r, id: `e${records.length + 1}`, createdAt: new Date().toISOString() };
    records.push(rec);
    await save(records);
    return rec;
  });
}

export function updateRecord(id: string, patch: Partial<EditRecord>): Promise<EditRecord | undefined> {
  return locked(async () => {
    const records = await load();
    const i = records.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    records[i] = { ...records[i], ...patch };
    await save(records);
    return records[i];
  });
}

export async function getRecord(id: string) {
  return (await load()).find((r) => r.id === id);
}

export async function recordsForSource(source: string) {
  return (await load()).filter((r) => r.source === source);
}

export async function findByHash(hash: string) {
  const records = await load();
  return {
    asOriginal: records.filter((r) => r.originalSha256 === hash),
    asEdit: records.find((r) => r.editedSha256 === hash),
  };
}
