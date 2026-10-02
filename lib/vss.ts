import { env } from "./env";

// Thin client for the team's VSS retrieval backend (`$INGRESS_URL/api/v1`).
// Logs in once with the team credentials, caches the JWT, and re-logs in on 401.

let cached: { token: string; at: number } | null = null;
const TOKEN_TTL_MS = 20 * 60 * 1000;

async function login(): Promise<string> {
  if (!env.vssUrl) throw new Error("VSS_URL / INGRESS_URL is not set");
  const res = await fetch(`${env.vssUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: env.vssUser, password: env.vssPass }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`VSS login failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("VSS login returned no access_token");
  cached = { token: data.access_token, at: Date.now() };
  return data.access_token;
}

export async function vssToken(force = false): Promise<string> {
  if (!force && cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  return login();
}

type VssInit = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
};

export async function vss<T = unknown>(path: string, init: VssInit = {}): Promise<T> {
  const url = new URL(`${env.vssUrl}/api/v1${path}`);
  for (const [k, v] of Object.entries(init.query || {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const call = (token: string) =>
    fetch(url, {
      method: init.method || (init.body ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 90_000),
    });

  let res = await call(await vssToken());
  if (res.status === 401) res = await call(await vssToken(true));
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`VSS ${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/** Upstream URL that streams one segment mp4 (JWT goes in the query for <video> compatibility). */
export async function segmentStreamUrl(source: string): Promise<string> {
  const token = await vssToken();
  return `${env.vssUrl}/api/v1/videos/stream?source=${encodeURIComponent(source)}&token=${encodeURIComponent(token)}`;
}

/** Download a whole segment (~5 s mp4) into memory, for Cosmos / fal / hashing. */
export async function fetchSegment(source: string): Promise<Buffer> {
  let res = await fetch(await segmentStreamUrl(source), { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (res.status === 401) {
    await vssToken(true);
    res = await fetch(await segmentStreamUrl(source), { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  }
  if (!res.ok) throw new Error(`segment download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
