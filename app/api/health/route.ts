import { env } from "@/lib/env";
import { vssToken } from "@/lib/vss";

// GET /api/health — what is configured and whether VSS login works. Never returns secrets.
export async function GET() {
  let vss: string = env.vssUrl ? "configured" : "missing VSS_URL / INGRESS_URL";
  if (env.vssUrl) {
    try {
      await vssToken(true);
      vss = "ok";
    } catch (e) {
      vss = e instanceof Error ? e.message : "login failed";
    }
  }
  return Response.json({
    vss,
    voice: env.elevenKey && env.elevenAgentId ? "ok" : "missing ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID",
    edit: env.falKey ? `ok (${env.editModel})` : "missing FAL_KEY",
    cosmos: env.cosmosUrl ? "configured" : "missing COSMOS3_REASON_URL",
    yolo: env.yoloUrl ? "configured" : "missing YOLO_URL (pipeline sidecars still work)",
    polish: env.wandbKey ? `W&B ${env.wandbModel}` : "off (no WANDB_API_KEY)",
  });
}
