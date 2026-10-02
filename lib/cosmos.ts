import { env, gpuHeaders } from "./env";

// Direct calls to NVIDIA Cosmos3-Reason (OpenAI-compatible chat, accepts mp4 as a base64
// data URL). Used for "look closer" questions and for describing original vs edited clips.

let servedModel: string | undefined;
const TRANSIENT = new Set([502, 503, 504]);

/** The model id to send: COSMOS3_REASON_MODEL / VM config, else whatever the endpoint serves. */
export async function cosmosModel(refresh = false): Promise<string> {
  if (!env.cosmosUrl) throw new Error("COSMOS3_REASON_URL is not set");
  if (!refresh && servedModel) return servedModel;
  if (!refresh && env.cosmosModel) return (servedModel = env.cosmosModel);
  const res = await fetch(`${env.cosmosUrl}/v1/models`, {
    headers: gpuHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Cosmos /v1/models → ${res.status}`);
  const id = ((await res.json()) as { data?: { id?: string }[] }).data?.[0]?.id;
  if (!id) throw new Error("Cosmos endpoint serves no models");
  return (servedModel = id);
}

export async function askCosmos(video: Buffer, question: string, maxTokens = 500): Promise<string> {
  const payload: Record<string, unknown> = {
    model: await cosmosModel(),
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

  // The nginx in front of the GPU node returns short-lived 502s under load; retry those.
  const post = async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${env.cosmosUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gpuHeaders() },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      });
      if (!TRANSIENT.has(res.status) || attempt >= 2) return res;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  };

  let res = await post();
  if (res.status === 404 && (await res.clone().text()).includes("does not exist")) {
    payload.model = await cosmosModel(true);
    res = await post();
  }
  if (res.status === 400 && (await res.clone().text()).includes("media_io_kwargs")) {
    delete payload.media_io_kwargs;
    res = await post();
  }
  if (!res.ok) throw new Error(`Cosmos3-Reason → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || "";
  // Some deployments inline their reasoning; keep only the answer.
  const answer = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!answer) throw new Error("Cosmos3-Reason returned an empty answer");
  return answer;
}

export const DESCRIBE_FOR_FORENSICS =
  "Describe exactly what happens in this clip, second by second. List every vehicle and person, " +
  "their colours and positions, any contact, collision, damage or debris, and anything that looks " +
  "visually inconsistent (warping, objects appearing or vanishing, smeared textures). Plain prose, under 120 words.";
