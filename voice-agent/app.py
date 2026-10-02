import base64, glob, json, os, httpx
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
SCHEMA = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p}}} for n, (_, d, p) in TOOLS.items()]
SYSTEM = ("You are a voice assistant for a video surveillance archive (warehouse, indoor robots/AGVs, SF streets, I-24 highway, Toronto dashcam). "
          "Use tools to find footage. metadata_filters.location must be exactly one of: indoor, nashville (I-24 highway), neighborhood, "
          "san_francisco, toronto, warehouse3 (forklift sim); omit the filter if unsure. Answer in 1-3 short spoken sentences, no markdown, mention camera/location and times. "
          "Matching clips are shown on screen automatically, so never offer to show them.")
history = [{"role": "system", "content": SYSTEM}]

def clips_from(result):
    rows = result.get("results") or result.get("evidence", {}).get("chunks") or []
    return [{"src": r.get("source") or r.get("preview_source"), "score": r.get("similarity_score"),
             "caption": (r.get("reasoning_content") or "")[:400], "camera": r.get("camera_id"), "location": r.get("location"),
             "start": r.get("segment_start_sec") or r.get("best_match_start_sec"), "end": r.get("segment_end_sec") or r.get("best_match_end_sec"),
             "objects": r.get("object_counts"), "time": r.get("upload_timestamp")}
            for r in rows if r.get("source") or r.get("preview_source")][:6]

@app.post("/api/turn")
async def turn(audio: UploadFile = None, text: str = Form(None)):
    if audio:
        text = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", headers=XI, timeout=60, data={"model_id": "scribe_v1"},
                          files={"file": ("a.webm", await audio.read(), "audio/webm")}).json()["text"]
    history.append({"role": "user", "content": text})
    clips = []
    for _ in range(5):
        msg = oai.chat.completions.create(model=MODEL, messages=history, tools=SCHEMA).choices[0].message
        history.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for c in msg.tool_calls:
            out = TOOLS[c.function.name][0](json.loads(c.function.arguments or "{}"))
            clips = clips_from(out) or clips
            history.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(out)[:12000]})
    voice = env.get("SIGHTLINE_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    tts = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", timeout=60,
                     headers=XI, json={"text": msg.content, "model_id": "eleven_flash_v2_5"})
    return {"heard": text, "reply": msg.content, "clips": clips,
            "audio": base64.b64encode(tts.content).decode() if tts.is_success else None}

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
