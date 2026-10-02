import type { NextRequest } from "next/server";
import { cosmosModel } from "@/lib/cosmos";
import { env, gpuHeaders } from "@/lib/env";
import { vssToken } from "@/lib/vss";

// GET /api/health          — live check of every integration (a few seconds at most).
// GET /api/health?quick=1  — configuration only, no network calls (readiness probes).
// Values are "ok…" when usable, otherwise the reason. Never returns secrets.

const msg = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

async function reach(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(6_000) });
}

async function checkVss() {
  if (!env.vssUrl) return "missing VSS_URL / INGRESS_URL";
  await vssToken(true);
  return "ok";
}

async function checkVoice() {
  if (!env.elevenKey) return "missing ELEVENLABS_API_KEY";
  if (!env.elevenAgentId) return "missing ELEVENLABS_AGENT_ID (run npm run agent:setup)";
  const r = await reach(`https://api.elevenlabs.io/v1/convai/agents/${env.elevenAgentId}`, { "xi-api-key": env.elevenKey });
  if (r.status === 404) return "agent not found (run npm run agent:setup)";
  if (r.status === 401) return "ElevenLabs rejected the API key";
  if (!r.ok) return `ElevenLabs ${r.status}`;
  const agent = (await r.json()) as { conversation_config?: { agent?: { prompt?: { llm?: string } } } };
  const llm = agent.conversation_config?.agent?.prompt?.llm;
  return `ok${llm ? ` (${llm})` : ""}`;
}

async function checkCosmos() {
  if (!env.cosmosUrl) return "missing COSMOS3_REASON_URL";
  const r = await reach(`${env.cosmosUrl}/v1/models`, gpuHeaders());
  if (!r.ok) return `Cosmos ${r.status}`;
  const served = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) || [];
  const model = await cosmosModel();
  return served.includes(model) ? `ok (${model})` : `model ${model} not served (serving: ${served.join(", ")})`;
}

async function checkYolo() {
  if (!env.yoloUrl) return "missing YOLO_URL (pipeline sidecars still work)";
  const r = await reach(`${env.yoloUrl}/healthz`, gpuHeaders());
  if (!r.ok) return `YOLO ${r.status}`;
  const h = (await r.json().catch(() => ({}))) as { model_loaded?: boolean };
  return h.model_loaded === false ? "YOLO model not loaded" : "ok";
}

async function checkPolish() {
  if (!env.wandbKey) return "off (no WANDB_API_KEY)";
  const r = await reach("https://api.inference.wandb.ai/v1/models", {
    Authorization: `Bearer ${env.wandbKey}`,
    ...(env.wandbProject ? { "OpenAI-Project": env.wandbProject } : {}),
  });
  return r.ok ? `ok (W&B ${env.wandbModel})` : `W&B ${r.status} (edits fall back to the user's words)`;
}

const edit = () => (env.falKey ? `ok (${env.editModel})` : "missing FAL_KEY");

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.has("quick")) {
    return Response.json({
      vss: env.vssUrl ? "configured" : "missing VSS_URL / INGRESS_URL",
      voice: env.elevenKey && env.elevenAgentId ? "configured" : "missing ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID",
      edit: edit(),
      cosmos: env.cosmosUrl ? "configured" : "missing COSMOS3_REASON_URL",
      yolo: env.yoloUrl ? "configured" : "missing YOLO_URL",
    });
  }
  const checks = { vss: checkVss, voice: checkVoice, cosmos: checkCosmos, yolo: checkYolo, polish: checkPolish };
  const results = await Promise.all(
    Object.entries(checks).map(async ([k, fn]) => [k, await fn().catch((e) => `unreachable: ${msg(e)}`)] as const),
  );
  return Response.json({ ...Object.fromEntries(results), edit: edit() });
}
