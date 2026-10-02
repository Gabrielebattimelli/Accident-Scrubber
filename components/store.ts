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
