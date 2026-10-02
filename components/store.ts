"use client";

import { useSyncExternalStore } from "react";
import type { Clip, Detections, EditRecord } from "@/lib/types";

// Tiny external store shared by the voice-tool handlers and the UI. Handlers read
// `store.get()` synchronously, so a search followed instantly by show_clip never sees stale state.

export type Activity = {
  id: number;
  at: number;
  tool: string;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
  ms?: number;
};

export type Line = { id: number; at: number; role: "user" | "agent"; text: string };

export type VerifyReport = {
  verdict: "AI-EDITED" | "ORIGINAL" | "PENDING";
  editId?: string;
  clipId?: string;
  raw: Record<string, unknown>;
};

export type State = {
  clips: Clip[];
  nextClip: number;
  activeClipId?: string;
  edits: Record<string, EditRecord>;
  activeEditId?: string;
  activity: Activity[];
  transcript: Line[];
  verify?: VerifyReport;
  detections: Record<string, Detections>; // by clip id
  overlay: Overlay;
  seek?: Seek;
  lastQuery?: string;
  // Everything below is screen state the agent drives (layouts, zoom, notes, cards).
  layout: Layout;
  editView: "slider" | "split";
  rate: number;
  play?: { paused: boolean; n: number }; // one-shot play/pause request for the main player
  zoom?: Zoom;
  notes: Note[];
  caption?: string;
  markers: Marker[];
  cards: Card[];
  spotlight: string[]; // clip ids ringed in the reel
};

/** What the stage shows: one clip, a grid of clips, or two clips side by side in sync. */
export type Layout = { mode: "single" } | { mode: "grid"; clipIds: string[] } | { mode: "compare"; clipIds: [string, string]; title?: string };

/** Zoom into the player: follow a tracked object, or a fixed point (0–1 frame coords). */
export type Zoom = { clipId: string; scale: number; object?: string; x: number; y: number };

/** A callout on the video, pinned to a tracked object or a point, optionally only between from–to. */
export type Note = { id: number; clipId: string; text: string; object?: string; x?: number; y?: number; from?: number; to?: number };

export type Marker = { id: number; clipId: string; t: number; label: string };

/** A generated UI card on the agent board. Every section is optional. */
export type Card = {
  id: string;
  at: number;
  title: string;
  tone: "note" | "finding" | "warning" | "ok";
  body?: string;
  stats?: [string, string][];
  bars?: [string, number][];
  bullets?: string[];
  clips?: string[];
  moments?: [number, string][]; // seconds into `clipId`
  clipId?: string;
};

/** Bounding-box layer over the clip player. `labels` empty = every class. Track ids are per clip. */
export type Overlay = { on: boolean; labels: string[]; focus?: { clipId: string; id: string } };

/** One-shot request for the clip player; `n` makes repeated seeks to the same time distinct. */
export type Seek = { clipId: string; t: number; pause: boolean; n: number };

const initial: State = {
  clips: [],
  nextClip: 1,
  edits: {},
  activity: [],
  transcript: [],
  detections: {},
  overlay: { on: false, labels: [] },
  layout: { mode: "single" },
  editView: "slider",
  rate: 1,
  notes: [],
  markers: [],
  cards: [],
  spotlight: [],
};
let state = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Select a slice. Return existing references or primitives only (no new objects). */
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state), () => select(initial));
}

let seq = 0;
export const nextId = () => ++seq;
