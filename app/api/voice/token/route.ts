import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

// GET /api/voice/token?transport=webrtc|websocket
// Mints a short-lived ElevenLabs credential so the API key never reaches the browser.
export async function GET(req: NextRequest) {
  if (!env.elevenKey || !env.elevenAgentId) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set (run `npm run agent:setup`)" },
      { status: 500 },
    );
  }
  const transport = req.nextUrl.searchParams.get("transport") === "websocket" ? "websocket" : "webrtc";
  const endpoint =
    transport === "webrtc"
      ? `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${env.elevenAgentId}`
      : `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${env.elevenAgentId}`;

  const res = await fetch(endpoint, { headers: { "xi-api-key": env.elevenKey }, cache: "no-store" });
  if (!res.ok) {
    return Response.json({ error: `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
  }
  const data = (await res.json()) as { token?: string; signed_url?: string };
  return Response.json(
    transport === "webrtc" ? { transport, token: data.token } : { transport, signedUrl: data.signed_url },
  );
}
