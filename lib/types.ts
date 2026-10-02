// Shared between server routes and the browser.

/** One ~5 s segment from the VSS archive. `id` is a short spoken handle ("c3") assigned in the browser. */
export type Clip = {
  id: string;
  source: string; // s3:// URI of the segment (playable via /api/video)
  originalVideo?: string; // parent upload the segment was cut from
  cameraId?: string;
  location?: string;
  start?: number; // seconds into the parent video
  end?: number;
  score?: number;
  caption?: string; // Cosmos3-Reason description written at ingest
};

export type ClipHit = Omit<Clip, "id">;

export type EditStatus = "queued" | "running" | "done" | "failed";

/** Provenance record for every AI edit. Persisted in .data/ledger.json. */
export type EditRecord = {
  id: string;
  createdAt: string;
  source: string;
  clipId?: string;
  instruction: string; // what the user asked for
  prompt: string; // what was actually sent to the edit model
  model: string;
  falRequestId?: string;
  originalSha256: string;
  originalBytes: number;
  status: EditStatus;
  editedUrl?: string;
  editedSha256?: string;
  finishedAt?: string;
  error?: string;
};
