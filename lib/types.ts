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

/** One tracked object across a clip. `id` is the spoken handle, e.g. "truck 2". */
export type TrackInfo = {
  id: string;
  label: string;
  start: number; // seconds into the clip
  end: number;
  frames: number;
  conf: number; // mean confidence
  motion: string; // e.g. "moves left to right, approaching"
};

/** [track index, x1, y1, x2, y2, confidence]; coordinates are 0–1 fractions of the frame. */
export type TrackedBox = [number, number, number, number, number, number];

/** YOLO11 detections for a clip, linked into tracks. `frames[i]` holds the boxes at `times[i]`. */
export type Detections = {
  via: string;
  aspect: number; // frame width / height
  counts: Record<string, number>; // most seen at once, per class
  unique: Record<string, number>; // distinct tracked objects, per class
  tracks: TrackInfo[];
  times: number[];
  frames: TrackedBox[][];
};

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
