import { env, gpuHeaders } from "./env";

// Direct calls to NVIDIA Cosmos3-Reason (OpenAI-compatible chat, accepts mp4 as a base64
// data URL). Used for "look closer" questions and for describing original vs edited clips.

export async function askCosmos(video: Buffer, question: string, maxTokens = 500): Promise<string> {
  if (!env.cosmosUrl) throw new Error("COSMOS3_REASON_URL is not set");
  const payload: Record<string, unknown> = {
    model: env.cosmosModel,
    messages: [
      {
        role: "user",
        content: [
          // Video before text works best with Cosmos.
          { type: "video_url", video_url: { url: `data:video/mp4;base64,${video.toString("base64")}` } },
          { type: "text", text: question },
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
    media_io_kwargs: { video: { fps: 4 } },
  };

  const post = () =>
    fetch(`${env.cosmosUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...gpuHeaders() },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });

  let res = await post();
  if (res.status === 400 && (await res.clone().text()).includes("media_io_kwargs")) {
    delete payload.media_io_kwargs;
    res = await post();
  }
  if (!res.ok) throw new Error(`Cosmos3-Reason → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || "";
  // Some deployments inline their reasoning; keep only the answer.
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export const DESCRIBE_FOR_FORENSICS =
  "Describe exactly what happens in this clip, second by second. List every vehicle and person, " +
  "their colours and positions, any contact, collision, damage or debris, and anything that looks " +
  "visually inconsistent (warping, objects appearing or vanishing, smeared textures). Plain prose, under 120 words.";
