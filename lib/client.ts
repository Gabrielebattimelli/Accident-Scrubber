// Browser-side helpers. BASE is "/app" when served behind the team ingress, "" otherwise.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const TRANSPORT: "webrtc" | "websocket" =
  process.env.NEXT_PUBLIC_VOICE_TRANSPORT === "websocket" ? "websocket" : "webrtc";

export const videoSrc = (source: string) => `${BASE}/api/video?source=${encodeURIComponent(source)}`;

export async function callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string };
  if (!json.ok) throw new Error(json.error || `${name} failed (${res.status})`);
  return json.result as T;
}

export const fmtTime = (s?: number) => {
  if (s === undefined) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
