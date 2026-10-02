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
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as EditRecord[];
  } catch {
    return [];
  }
}

async function save(records: EditRecord[]) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2));
  await fs.rename(tmp, FILE);
}

export async function createRecord(r: Omit<EditRecord, "id" | "createdAt">): Promise<EditRecord> {
  const records = await load();
  const rec: EditRecord = { ...r, id: `e${records.length + 1}`, createdAt: new Date().toISOString() };
  records.push(rec);
  await save(records);
  return rec;
}

export async function updateRecord(id: string, patch: Partial<EditRecord>): Promise<EditRecord | undefined> {
  const records = await load();
  const i = records.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  records[i] = { ...records[i], ...patch };
  await save(records);
  return records[i];
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
