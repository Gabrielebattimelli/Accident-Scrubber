import { env } from "./env";

// Turns a spoken edit request ("get rid of the truck") into a precise instruction for the
// video-edit model, using W&B Inference (CoreWeave). Optional: any failure or a missing key
// falls back to the user's own words, so editing never blocks on this step.

const SYSTEM =
  "You rewrite a user's spoken request into ONE edit instruction for a model that must modify the original camera clip in place. " +
  "Describe only the change. Do not redesign the scene, restage it, or describe a new shot. " +
  "End with: keep the original camera, framing, timing, people, vehicles and motion exactly as they are. " +
  "Present tense, under 50 words, no preamble.";

export async function polishEditPrompt(instruction: string, caption?: string): Promise<string> {
  if (!env.wandbKey) return instruction;
  try {
    const res = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.wandbKey}`,
        "Content-Type": "application/json",
        ...(env.wandbProject ? { "OpenAI-Project": env.wandbProject } : {}),
      },
      body: JSON.stringify({
        model: env.wandbModel,
        temperature: 0.2,
        // gpt-oss is a reasoning model: at default effort it spends the whole budget thinking
        // and returns no content, and takes longer than the timeout.
        max_tokens: 1000,
        ...(env.wandbModel.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Clip description: ${caption || "unknown"}\nRequest: ${instruction}`,
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[polish] W&B ${res.status}, using the user's words`);
      return instruction;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const out = data.choices?.[0]?.message?.content?.trim();
    return out && out.length > 10 ? out : instruction;
  } catch (e) {
    console.warn(`[polish] ${e instanceof Error ? e.message : e}, using the user's words`);
    return instruction;
  }
}
