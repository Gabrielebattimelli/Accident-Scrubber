import { env } from "./env";

// Turns a spoken edit request ("get rid of the truck") into a precise instruction for the
// video-edit model, using W&B Inference (CoreWeave). Optional: any failure or a missing key
// falls back to the user's own words, so editing never blocks on this step.

const SYSTEM =
  "You rewrite a user's spoken request into ONE precise instruction for a video-to-video editing model. " +
  "Name exactly what changes. Then state that camera position, framing, lighting, weather, timing and " +
  "every other object stay exactly as in the original. Present tense, under 60 words, no preamble.";

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
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Clip description: ${caption || "unknown"}\nRequest: ${instruction}`,
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return instruction;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content?.trim();
    return out && out.length > 10 ? out : instruction;
  } catch {
    return instruction;
  }
}
