// Server-only configuration. On the VAST workshop VM the VSS/GPU/W&B variables are already
// exported from /config/<team>.config, so the fallbacks below pick them up unchanged.

const trim = (s: string | undefined) => (s || "").trim().replace(/\/+$/, "");

export const env = {
  vssUrl: trim(process.env.VSS_URL || process.env.INGRESS_URL),
  vssUser: process.env.VSS_USERNAME || process.env.USERNAME || "",
  vssPass: process.env.VSS_PASSWORD || process.env.PASSWORD || "",

  cosmosUrl: trim(process.env.COSMOS3_REASON_URL),
  cosmosModel: process.env.COSMOS3_REASON_MODEL || "nvidia/cosmos3-reason",
  gpuToken: process.env.GPU_BEARER_TOKEN || "",
  yoloUrl: trim(process.env.YOLO_URL),

  elevenKey: process.env.ELEVENLABS_API_KEY || "",
  elevenAgentId: process.env.ELEVENLABS_AGENT_ID || "",

  falKey: process.env.FAL_KEY || "",
  editModel: process.env.FAL_EDIT_MODEL || "google/gemini-omni-flash/v1.1/edit",
  editResolution: process.env.FAL_EDIT_RESOLUTION || "720p",
  editExtra: process.env.FAL_EDIT_EXTRA_JSON || "",

  wandbKey: process.env.WANDB_API_KEY || "",
  wandbProject:
    process.env.WANDB_TEAM && process.env.WANDB_PROJECT
      ? `${process.env.WANDB_TEAM}/${process.env.WANDB_PROJECT}`
      : process.env.WANDB_PROJECT || "",
  wandbModel: process.env.WANDB_MODEL || "openai/gpt-oss-120b",
};

export function gpuHeaders(): Record<string, string> {
  return env.gpuToken ? { Authorization: `Bearer ${env.gpuToken}` } : {};
}
