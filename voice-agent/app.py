import base64, glob, json, os, queue, httpx
from concurrent.futures import ThreadPoolExecutor
from dotenv import dotenv_values
from fastapi import FastAPI, Request, UploadFile, Form
from fastapi.responses import FileResponse, StreamingResponse
from openai import OpenAI

HERE = os.path.dirname(os.path.abspath(__file__))
env = {}
for f in [*glob.glob("/config/*.config"), os.path.expanduser("~/.env"), os.path.join(HERE, "../.env"), os.path.join(HERE, ".env")]:
    env.update({k: v for k, v in dotenv_values(f).items() if v})
env.update(os.environ)
for new, old in [("VSS_URL", "INGRESS_URL"), ("VSS_USERNAME", "USERNAME"), ("VSS_PASSWORD", "PASSWORD")]:
    env[new] = env.get(new) or env.get(old)
VSS, app = env["VSS_URL"].rstrip("/"), FastAPI()
http = httpx.Client(base_url=f"{VSS}/api/v1", timeout=120)
token = None
XI = {"xi-api-key": env["ELEVENLABS_API_KEY"]}

def pick_llm():
    try:
        (c := OpenAI(api_key=env.get("OPENAI_API_KEY"))).models.list()
        return c, "gpt-4o-mini"
    except Exception:
        return OpenAI(base_url="https://api.inference.wandb.ai/v1", api_key=env["WANDB_API_KEY"],
                      project=f"{env['WANDB_TEAM']}/{env['WANDB_PROJECT']}"), "openai/gpt-oss-120b"
oai, MODEL = pick_llm()
print("LLM:", MODEL)

def vss(method, path, retry=True, **kw):
    global token
    if not token:
        token = http.post("/auth/login", json={"username": env["VSS_USERNAME"], "password": env["VSS_PASSWORD"]}).json()["access_token"]
    r = http.request(method, path, headers={"Authorization": f"Bearer {token}"}, **kw)
    if r.status_code == 401 and retry:
        token = None
        return vss(method, path, False, **kw)
    return r.json()

TOOLS = {
    "search_videos": (lambda a: vss("POST", "/search", json={"top_k": 8, "min_similarity": 0.2, **a}),
        "Hybrid semantic search over video segments.",
        {"query": {"type": "string"}, "metadata_filters": {"type": "object", "description": "e.g. {\"location\": \"warehouse3\"}"}}),
    "ask_archive": (lambda a: vss("POST", "/agent/ask", json={"top_k": 10, **a}),
        "Grounded Q&A over the archive, or over one parent video if original_video given.",
        {"question": {"type": "string"}, "original_video": {"type": "string"}}),
    "summarize_video": (lambda a: vss("POST", "/videos/synthesize", json={"max_segments": 40, **a}),
        "Summarize one whole parent video (s3 URI).",
        {"original_video": {"type": "string"}, "question": {"type": "string"}}),
    "list_metadata_values": (lambda a: vss("GET", "/metadata/values", params=a),
        "List valid values for a metadata field such as location or camera_id.",
        {"field": {"type": "string"}}),
}
SCHEMA = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p, "required": [next(iter(p))]}}} for n, (_, d, p) in TOOLS.items()]
SYSTEM = ("You are Sightline, a sharp coworker sitting next to the user, reviewing a video camera archive together "
          "(warehouse forklift sim, indoor robots/AGVs, SF streets, I-24 highway, Toronto dashcam, a neighborhood street). "
          "Use tools to find footage. metadata_filters.location must be exactly one of: indoor, nashville (I-24 highway), neighborhood, "
          "san_francisco, toronto, warehouse3 (forklift sim); omit the filter if unsure. "
          "You speak out loud, so talk like a person: casual, contractions, 1-3 short sentences, no lists or markdown. "
          "You've already told them you're looking, so never say 'let me check'; lead with what you actually saw, mention the camera and time naturally, "
          "and when it's useful, suggest a next thing to look at or ask a quick follow-up. "
          "Matching clips appear on their screen automatically, so never offer to show them. If nothing good turned up, say so plainly.")
ACK = ("You are Sightline, a coworker helping someone review security camera footage, speaking out loud. They just said the last message. "
       "Reply with ONLY a very short, natural spoken acknowledgment (3-12 words) like a colleague would say right before going to look, "
       "e.g. 'Yeah, one sec, pulling up the warehouse cams.' or 'Oh, good call, checking San Francisco.' Vary it. "
       "Do not answer the question or invent any findings. If the message needs no footage lookup (greetings, thanks, small talk), reply exactly SKIP.")
history = [{"role": "system", "content": SYSTEM}]
pool = ThreadPoolExecutor(8)

def speak(text):
    voice = env.get("SIGHTLINE_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", timeout=60, headers=XI,
                   json={"text": text, "model_id": "eleven_flash_v2_5"})
    return base64.b64encode(r.content).decode() if r.is_success else None

def clips_from(result):
    rows = result.get("results") or result.get("evidence", {}).get("chunks") or []
    return [{"src": r.get("source") or r.get("preview_source"), "score": r.get("similarity_score"),
             "caption": (r.get("reasoning_content") or "")[:400], "camera": r.get("camera_id"), "location": r.get("location"),
             "start": r.get("segment_start_sec") or r.get("best_match_start_sec"), "end": r.get("segment_end_sec") or r.get("best_match_end_sec"),
             "objects": r.get("object_counts"), "time": r.get("upload_timestamp")}
            for r in rows if r.get("source") or r.get("preview_source")][:6]

def for_llm(out, clips):
    if clips:
        return json.dumps({"synthesis": (out.get("llm_synthesis") or {}).get("response") or out.get("answer"),
                           "clips": [{k: v for k, v in c.items() if k != "src"} for c in clips]})
    return json.dumps(out)[:8000]

def acknowledge(text, q):
    recent = [{"role": m["role"], "content": m["content"]} for m in history[-6:] if m["role"] in ("user", "assistant") and m.get("content")]
    try:
        say = oai.chat.completions.create(model=MODEL, max_tokens=40, messages=[{"role": "system", "content": ACK}, *recent]).choices[0].message.content
        if say and "SKIP" not in say:
            q.put({"type": "say", "text": say.strip(), "audio": speak(say)})
    except Exception:
        pass

def agent(text, q, ack):
    for _ in range(5):
        msg = oai.chat.completions.create(model=MODEL, messages=history, tools=SCHEMA).choices[0].message
        history.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for c in msg.tool_calls:
            args = json.loads(c.function.arguments or "{}")
            q.put({"type": "tool", "name": c.function.name, "args": args})
            out = TOOLS[c.function.name][0](args)
            clips = clips_from(out)
            if clips:
                q.put({"type": "clips", "clips": clips, "query": args.get("query") or args.get("question") or text})
            history.append({"role": "tool", "tool_call_id": c.id, "content": for_llm(out, clips)})
    audio = speak(msg.content)
    ack.result()
    q.put({"type": "reply", "text": msg.content, "audio": audio})

def run(text):
    q = queue.Queue()
    yield json.dumps({"type": "heard", "text": text}) + "\n"
    history.append({"role": "user", "content": text})
    ack = pool.submit(acknowledge, text, q)
    def work():
        try:
            agent(text, q, ack)
        except Exception as e:
            q.put({"type": "error", "text": str(e)[:200]})
        q.put(None)
    pool.submit(work)
    while (e := q.get()) is not None:
        yield json.dumps(e) + "\n"

@app.post("/api/turn")
async def turn(audio: UploadFile = None, text: str = Form(None)):
    if audio:
        text = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", headers=XI, timeout=60, data={"model_id": "scribe_v1"},
                          files={"file": ("a.webm", await audio.read(), "audio/webm")}).json().get("text", "")
    if not (text or "").strip():
        return StreamingResponse(iter([json.dumps({"type": "error", "text": "I didn't catch that."}) + "\n"]), media_type="application/x-ndjson")
    return StreamingResponse(run(text), media_type="application/x-ndjson")

@app.get("/api/status")
def status():
    try:
        vss("GET", "/auth/me")
        return {"ok": True, "model": MODEL}
    except Exception:
        return {"ok": False, "model": MODEL}

@app.get("/clip")
def clip(src: str, request: Request):
    vss("GET", "/auth/me")
    hdrs = {"Range": request.headers["range"]} if "range" in request.headers else {}
    r = http.send(http.build_request("GET", "/videos/stream", params={"source": src, "token": token}, headers=hdrs), stream=True)
    keep = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges")}
    return StreamingResponse(r.iter_bytes(), status_code=r.status_code, headers=keep)

@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "index.html"))
