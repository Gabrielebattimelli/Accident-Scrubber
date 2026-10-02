import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Server-only configuration. Explicit environment variables always win. Anything unset falls
// back to the VAST workshop VM's /config directory: <team>.config (VSS login, GPU token) and
// <team>-vss2-secret.yaml (Cosmos + YOLO hosts and the Cosmos model id). On the VM that means
// only the ElevenLabs and fal keys have to be added by hand.

function readVmConfig(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  let files: string[];
  try {
    files = readdirSync(dir).sort();
  } catch {
    return out;
  }
  const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");
  for (const f of files) {
    if (!f.endsWith(".config") && !f.endsWith("-vss2-secret.yaml")) continue;
    let text: string;
    try {
      text = readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const pattern = f.endsWith(".config")
      ? /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm
      : /-[ \t]*key:[ \t]*(\S+)[ \t]*\r?\n[ \t]*value:[ \t]*(.*)$/gm;
    for (const m of text.matchAll(pattern)) out[m[1]] ??= unquote(m[2]);
  }
  return out;
}

const vm = readVmConfig(process.env.VM_CONFIG_DIR || "/config");

const pick = (...vals: (string | undefined)[]) => vals.map((v) => (v || "").trim()).find(Boolean) || "";
const trim = (s: string) => s.replace(/\/+$/, "");
const hostUrl = (scheme: string | undefined, host: string | undefined, port: string | undefined) =>
  host ? `${scheme || "http"}://${host}${port ? `:${port}` : ""}` : "";

export const env = {
  vssUrl: trim(pick(process.env.VSS_URL, process.env.INGRESS_URL, vm.INGRESS_URL)),
  // USERNAME/PASSWORD are generic names a desktop session may set to the OS user, so the
  // team config file is preferred over them.
  vssUser: pick(process.env.VSS_USERNAME, vm.USERNAME, process.env.USERNAME),
  vssPass: pick(process.env.VSS_PASSWORD, vm.PASSWORD, process.env.PASSWORD),

  cosmosUrl: trim(pick(process.env.COSMOS3_REASON_URL, hostUrl(vm.cosmoshttpscheme, vm.cosmos_host, vm.cosmos_port))),
  // Empty means "ask the endpoint" (GET /v1/models), see lib/cosmos.ts.
  cosmosModel: pick(process.env.COSMOS3_REASON_MODEL, vm.cosmos_model),
  gpuToken: pick(process.env.GPU_BEARER_TOKEN, vm.GPU_BEARER_TOKEN),
  yoloUrl: trim(pick(process.env.YOLO_URL, hostUrl("http", vm.yolo_infer_host, vm.yolo_infer_port))),

  elevenKey: pick(process.env.ELEVENLABS_API_KEY),
  elevenAgentId: pick(process.env.ELEVENLABS_AGENT_ID),

  falKey: pick(process.env.FAL_KEY, process.env.FAL_AI_API_KEY),
  editModel: pick(process.env.FAL_EDIT_MODEL) || "google/gemini-omni-flash/v1.1/edit",
  editResolution: pick(process.env.FAL_EDIT_RESOLUTION) || "720p",
  editExtra: pick(process.env.FAL_EDIT_EXTRA_JSON),

  wandbKey: pick(process.env.WANDB_API_KEY),
  wandbProject:
    process.env.WANDB_TEAM && process.env.WANDB_PROJECT
      ? `${process.env.WANDB_TEAM}/${process.env.WANDB_PROJECT}`
      : pick(process.env.WANDB_PROJECT),
  wandbModel: pick(process.env.WANDB_MODEL) || "openai/gpt-oss-120b",
};

export function gpuHeaders(): Record<string, string> {
  return env.gpuToken ? { Authorization: `Bearer ${env.gpuToken}` } : {};
}
