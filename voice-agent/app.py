import ast, base64, glob, json, os, queue, re, subprocess, tempfile, threading, time, uuid, httpx, fal_client
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from dotenv import dotenv_values
from fastapi import FastAPI, Request, UploadFile, Form
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool
from openai import OpenAI

HERE = os.path.dirname(os.path.abspath(__file__))
env = {}
for f in [*glob.glob("/config/*.config"), os.path.expanduser("~/.env"), os.path.join(HERE, "../.env"), os.path.join(HERE, ".env")]:
    env.update({k: v for k, v in dotenv_values(f).items() if v})
env.update(os.environ)
for new, old in [("VSS_URL", "INGRESS_URL"), ("VSS_USERNAME", "USERNAME"), ("VSS_PASSWORD", "PASSWORD"), ("FAL_KEY", "FAL_AI_API_KEY")]:
    env[new] = env.get(new) or env.get(old)
VSS, app = env["VSS_URL"].rstrip("/"), FastAPI()
http = httpx.Client(base_url=f"{VSS}/api/v1", timeout=120, limits=httpx.Limits(max_connections=100, max_keepalive_connections=30))
stream_http = httpx.AsyncClient(base_url=f"{VSS}/api/v1", timeout=httpx.Timeout(120, connect=15), limits=httpx.Limits(max_connections=200, max_keepalive_connections=40))
token = None
XI = {"xi-api-key": env["ELEVENLABS_API_KEY"]}
fal = fal_client.SyncClient(key=env.get("FAL_KEY"))
FAL_MODEL = env.get("FAL_EDIT_MODEL", "minimax/h3/reference-to-video")

def pick_llm():
    try:
        (c := OpenAI(api_key=env.get("OPENAI_API_KEY"))).models.list()
        return c, env.get("SIGHTLINE_MODEL", "gpt-4.1-mini")
    except Exception:
        return OpenAI(base_url="https://api.inference.wandb.ai/v1", api_key=env["WANDB_API_KEY"],
                      project=f"{env['WANDB_TEAM']}/{env['WANDB_PROJECT']}"), "openai/gpt-oss-120b"
oai, MODEL = pick_llm()
print("LLM:", MODEL)

def vss(method, path, retry=True, **kw):
    global token
    try:
        if not token:
            token = http.post("/auth/login", json={"username": env["VSS_USERNAME"], "password": env["VSS_PASSWORD"]}).json()["access_token"]
        r = http.request(method, path, headers={"Authorization": f"Bearer {token}"}, **kw)
        if r.status_code == 401:
            raise PermissionError
        return r.json()
    except (ValueError, PermissionError, httpx.TransportError):
        if not retry:
            raise RuntimeError(f"VSS {path} failed")
        token = None
        time.sleep(.5)
        return vss(method, path, False, **kw)

def chat(system, user, **kw):
    return oai.chat.completions.create(model=MODEL, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}], **kw).choices[0].message.content

def speak(text):
    voice = env.get("SIGHTLINE_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", timeout=60, headers=XI,
                   json={"text": text, "model_id": "eleven_flash_v2_5"})
    return base64.b64encode(r.content).decode() if r.is_success else None

# ---------- clips, angles, detections ----------
SCRUBS = {}

def angle(name):
    for pat in (r"(run_\d+_seed_\d+)\.((?:ceiling|eye)_\d+)\..*?(chunk_\d+_segment_\d+)", r"(Warehouse_\d+)_(Camera_\d+)_(chunk_\d+_segment_\d+)"):
        if m := re.search(pat, name or ""):
            return m.group(1) + m.group(3), m.group(2).replace("_", " ").replace("eye", "eye-level").title()
    return None, None

def clips_from(result, limit=6):
    rows = result.get("results") or result.get("evidence", {}).get("chunks") or []
    out = []
    for r in rows:
        src = r.get("source") or r.get("preview_source")
        if src:
            out.append({"src": src, "score": r.get("similarity_score"), "caption": (r.get("reasoning_content") or "")[:500],
                        "camera": r.get("camera_id"), "location": r.get("location"), "view": angle(src)[1],
                        "start": r.get("segment_start_sec") or r.get("best_match_start_sec"), "end": r.get("segment_end_sec") or r.get("best_match_end_sec"),
                        "objects": r.get("object_counts"), "time": r.get("upload_timestamp")})
    return out[:limit]

def relabel(label, loc):
    if label in ("truck", "car", "bus", "motorcycle", "train"):
        return {"warehouse3": "forklift", "indoor": "AGV"}.get(loc, label)
    return label

COSMOS_URL = (env.get("COSMOS3_REASON_URL") or "http://166.19.38.112:8001").rstrip("/")
COSMOS_MODEL = env.get("COSMOS3_REASON_MODEL") or "nvidia/cosmos3-nano-reasoner"
GROUND = {"warehouse3": "forklift", "indoor": "humanoid robot, AGV, pallet jack"}
ground_pool = ThreadPoolExecutor(10)

def clip_bytes(src):
    vss("GET", "/auth/me")
    return http.get("/videos/stream", params={"source": src, "token": token}).content

def ground_frame(jpg, what):
    body = {"model": COSMOS_MODEL, "max_tokens": 400, "temperature": 0, "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpg).decode()}},
        {"type": "text", "text": f"Detect every {what}. Output JSON only: [{{\"label\": ..., \"bbox_2d\": [x1, y1, x2, y2]}}] with coordinates normalized 0-1000."}]}]}
    r = httpx.post(f"{COSMOS_URL}/v1/chat/completions", json=body, timeout=60, headers={"Authorization": f"Bearer {env.get('GPU_BEARER_TOKEN', '')}"})
    txt = r.json()["choices"][0]["message"]["content"]
    return [(m[0].lower(), [int(v) for v in m[1:]]) for m in re.findall(r'"label":\s*"([^"]+)"[^\[\]]*?\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]', txt)]

def cosmos_track(src, what, w, h, fps=2):
    with tempfile.TemporaryDirectory() as tmp:
        open(f"{tmp}/c.mp4", "wb").write(clip_bytes(src))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f"{tmp}/c.mp4", "-vf", f"fps={fps},scale=960:-1", f"{tmp}/f%02d.jpg"], check=True)
        jpgs = [open(f"{tmp}/{n}", "rb").read() for n in sorted(os.listdir(tmp)) if n.endswith(".jpg")]
    found = list(ground_pool.map(lambda j: ground_frame(j, what), jpgs))
    return [((k + .5) / fps, [[lab, .9, b[0] * w / 1000, b[1] * h / 1000, b[2] * w / 1000, b[3] * h / 1000] for lab, b in f]) for k, f in enumerate(found)]

def iou(a, b):
    ix, iy = max(0, min(a[4], b[4]) - max(a[2], b[2])), max(0, min(a[5], b[5]) - max(a[3], b[3]))
    inter = ix * iy
    return inter / ((a[4] - a[2]) * (a[5] - a[3]) + (b[4] - b[2]) * (b[5] - b[3]) - inter + 1e-6)

def lerp_track(samples, t):
    before = [s for s in samples if s[0] <= t]
    after = [s for s in samples if s[0] > t]
    if not before or not after:
        return (before or after)[-1 if before else 0][1]
    (t0, a), (t1, b) = before[-1], after[0]
    if len(a) != len(b):
        return a if t - t0 < t1 - t else b
    k = (t - t0) / (t1 - t0)
    a, b = sorted(a, key=lambda x: x[2]), sorted(b, key=lambda x: x[2])
    return [[p[0], p[1], *[p[i] + (q[i] - p[i]) * k for i in range(2, 6)]] for p, q in zip(a, b)]

@lru_cache(128)
def detections(src, loc=""):
    d = vss("GET", "/videos/detections", params={"source": src})
    frames = d.get("frames") or []
    if isinstance(frames, str):
        frames = ast.literal_eval(frames)
    h, w = (d.get("video_shape") or [1080, 1920])[:2]
    out = {"w": w, "h": h, "fps": d.get("fps") or 30, "sources": ["YOLO11"], "frames": [
        [f.get("time_sec", 0), [[relabel(x["label"], loc), round(x.get("confidence", 0), 2), *x["bbox"]] for x in f.get("detections", [])]]
        for f in frames]}
    if loc in GROUND:
        try:
            track = cosmos_track(src, GROUND[loc], w, h)
            for fr in out["frames"]:
                machines = [[x[0], x[1], *map(round, x[2:])] for x in lerp_track(track, fr[0])]
                robots = [m for m in machines if "robot" in m[0]]
                people = [x for x in fr[1] if x[0] == "person" and not any(iou(x, r) > .4 for r in robots)]
                fr[1] = people + machines
            out["sources"].append("Cosmos3 grounding")
        except Exception as e:
            print("cosmos grounding failed:", e)
    return out

def other_angle(st, clip):
    scene, view = angle(clip["src"])
    if not scene:
        return None
    r = vss("POST", "/search", json={"query": st["query"] or clip["caption"][:200], "top_k": 50, "min_similarity": 0,
                                    "metadata_filters": {"location": clip["location"]}})
    same = [c for c in clips_from(r, 50) if angle(c["src"])[0] == scene and c["view"] != view]
    return same[0] if same else None

@lru_cache(256)
def thumb(src):
    vss("GET", "/auth/me")
    url = f"{VSS}/api/v1/videos/stream?{httpx.QueryParams({'source': src, 'token': token})}"
    jpg = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", "1", "-i", url, "-frames:v", "1", "-vf", "scale=420:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
                         capture_output=True, timeout=30).stdout
    if not jpg:
        raise RuntimeError("no frame")
    return jpg

POLISH = ("You rewrite a user's spoken request into ONE precise instruction for a video-to-video editing model. "
          "Name exactly what changes. Then state that camera position, framing, lighting, timing and every other object stay exactly as in the original. "
          "Present tense, under 60 words, no preamble.")

def edit_args(clip, prompt, url):
    if FAL_MODEL.startswith("minimax/"):
        secs = max(5, min(15, round((clip.get("end") or 5) - (clip.get("start") or 0))))
        return {"prompt": "Video 1 is a camera clip. Edit Video 1: " + prompt, "reference_video_urls": [url],
                "resolution": env.get("FAL_EDIT_RESOLUTION", "768P"), "duration": secs, "prompt_expansion_mode": "disabled"}
    return {"prompt": prompt, "video_url": url, **({"resolution": "720p"} if "gemini-omni" in FAL_MODEL else {})}

def scrub(clip, instruction):
    prompt = chat(POLISH, f"Clip description: {clip['caption']}\nRequest: {instruction}", max_tokens=200) or instruction
    url = fal.upload(clip_bytes(clip["src"]), "video/mp4", file_name="clip.mp4")
    job = fal.submit(FAL_MODEL, arguments=edit_args(clip, prompt, url)).request_id
    SCRUBS[job] = {"src": clip["src"], "prompt": prompt, "started": time.time()}
    return job, prompt

INCIDENT = ("You write incident reports for a safety team from camera evidence. Return JSON with keys title (max 8 words), "
            "severity (high|medium|low), summary (2 sentences, factual, mention camera, time window and what the people/machines did).")

def make_incident(clip, title=None, severity=None, summary=None):
    if not (title and summary):
        facts = {"camera": clip["camera"], "view": clip["view"], "location": clip["location"], "window": [clip["start"], clip["end"]],
                 "captured": clip["time"], "caption": clip["caption"]}
        draft = json.loads(chat(INCIDENT, json.dumps(facts), response_format={"type": "json_object"}))
        title, severity, summary = title or draft.get("title"), severity or draft.get("severity"), summary or draft.get("summary")
    return {"id": uuid.uuid4().hex[:6].upper(), "title": title, "severity": (severity or "low").lower(),
            "summary": summary, "clip": clip, "filed": time.time()}

# ---------- tools (shared by the voice agent and the UI buttons) ----------
# Every tool gets `st`, the clips/query/focus that this turn sees, so concurrent turns and browsers never step on each other.
def pick(st, args):
    n = args.get("clip")
    i = int(n) - 1 if n else st["focus"]
    if not st["clips"]:
        raise ValueError("No clips on screen yet. Search first.")
    return max(0, min(i, len(st["clips"]) - 1))

def t_search(st, a, emit):
    out = vss("POST", "/search", json={"top_k": 8, "min_similarity": 0.2, **{k: v for k, v in a.items() if k in ("query", "metadata_filters")}})
    clips = clips_from(out)
    if clips:
        st.update(clips=clips, query=a["query"], focus=0)
        emit({"type": "clips", "clips": clips, "query": a["query"]})
    return {"synthesis": (out.get("llm_synthesis") or {}).get("response"),
            "clips": [{"clip": i + 1, **{k: v for k, v in c.items() if k != "src"}} for i, c in enumerate(clips)]}

def t_focus(st, a, emit):
    i = pick(st, a); st["focus"] = i
    emit({"type": "ui", "action": "focus", "index": i})
    return f"Now showing clip {i + 1}."

def t_overlay(st, a, emit):
    emit({"type": "ui", "action": "overlay", "enabled": a.get("enabled", True), "classes": a.get("classes")})
    return "Overlay updated."

def t_seek(st, a, emit):
    emit({"type": "ui", "action": "seek", "seconds": float(a.get("seconds", 0))})
    return "Jumped."

def t_angle(st, a, emit):
    i = pick(st, a); other = other_angle(st, st["clips"][i])
    if not other:
        return "No other camera angle of this exact moment in the archive."
    emit({"type": "compare", "index": i, "other": other})
    return f"Showing {st['clips'][i]['view']} next to {other['view']} for the same moment."

def t_scrub(st, a, emit):
    i = pick(st, a); job, prompt = scrub(st["clips"][i], a.get("instruction") or "Remove every person from the scene")
    emit({"type": "scrub", "index": i, "src": st["clips"][i]["src"], "job": job, "prompt": prompt})
    return "Submitted to the video model. It takes a little while; the result appears side by side when ready."

def t_incident(st, a, emit):
    i = pick(st, a); inc = make_incident(st["clips"][i], a.get("title"), a.get("severity"), a.get("summary"))
    emit({"type": "incident", "incident": inc})
    return f"Filed incident {inc['id']}: {inc['title']} ({inc['severity']})."

def t_ask(st, a, emit):
    return vss("POST", "/agent/ask", json={"top_k": 10, **a})

S, I, B, A = {"type": "string"}, {"type": "integer", "description": "1-based clip number on screen; omit for the focused clip"}, {"type": "boolean"}, {"type": "array", "items": {"type": "string"}}
TOOLS = {
    "search_videos": (t_search, "Search all footage. Puts the top clips on screen and focuses #1.",
                      {"query": S, "metadata_filters": {"type": "object", "description": "e.g. {\"location\": \"warehouse3\"}"}}, ["query"]),
    "focus_clip": (t_focus, "Show a specific clip in the main viewer.", {"clip": I}, ["clip"]),
    "set_overlay": (t_overlay, "Toggle AI bounding boxes on the video, optionally only some classes (person, forklift, AGV, car, truck, bicycle, traffic light).",
                    {"enabled": B, "classes": A}, ["enabled"]),
    "seek": (t_seek, "Jump the viewer to a time in seconds within the clip.", {"seconds": {"type": "number"}}, ["seconds"]),
    "compare_angles": (t_angle, "Find the same moment from another camera angle and show both side by side.", {"clip": I}, []),
    "scrub_clip": (t_scrub, "Use the generative video model to edit the clip (e.g. remove a person or forklift). Shows original vs edited side by side.",
                   {"instruction": S, "clip": I}, ["instruction"]),
    "file_incident": (t_incident, "File an incident report for a clip into the case file.",
                      {"clip": I, "title": S, "severity": {"type": "string", "enum": ["high", "medium", "low"]}, "summary": S}, []),
    "ask_archive": (t_ask, "Grounded Q&A over the whole archive when a search isn't enough.", {"question": S}, ["question"]),
}
SCHEMA = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p, "required": r}}}
          for n, (_, d, p, r) in TOOLS.items()]

SYSTEM = ("You are Sightline, a sharp coworker sitting next to the user, reviewing a video camera archive together "
          "(warehouse forklift sim, indoor robots/AGVs, SF streets, I-24 highway, Toronto dashcam, a neighborhood street). "
          "You can drive their screen: search, focus a clip, toggle AI boxes, jump to a moment, pull up another camera angle, "
          "scrub a clip with the generative video model, and file incidents into the case file. Use these freely; that's the point. "
          "Never describe what you are about to do: call the tool right away, and only speak after you have results. "
          "metadata_filters.location must be exactly one of: indoor, nashville (I-24 highway), neighborhood, san_francisco, toronto, warehouse3 (forklift sim); omit if unsure. "
          "Each user message ends with [screen: ...] describing what they're looking at; 'this one' means the focused clip. "
          "You speak out loud, so talk like a person: casual, contractions, 1-3 short sentences, no lists or markdown, no clip filenames. "
          "You've already acknowledged them, so never say 'let me check'; lead with what you saw or did, mention camera and time naturally, "
          "and suggest a next move when useful (e.g. check the other angle, scrub it, file it). Never offer to show clips; they're already on screen.")
ACK = ("You are Sightline, a coworker helping someone review security camera footage, speaking out loud. They just said the last message. "
       "Reply with ONLY a very short, natural spoken acknowledgment (3-10 words) like a colleague would say right before doing it, "
       "e.g. 'Yeah, one sec, pulling up the warehouse cams.' or 'On it, grabbing the other angle.' Vary it. Do not answer or invent findings. "
       "If it's small talk, or a quick screen command (show boxes, next clip, go to 3 seconds, hide labels), reply exactly SKIP.")
pool = ThreadPoolExecutor(16)
SESSIONS = {}

def session(sid):
    return SESSIONS.setdefault(sid or "default", {"clips": [], "query": "", "focus": 0, "turn": 0, "lock": threading.Lock(),
                                                  "history": [{"role": "system", "content": SYSTEM}]})

def remember(sess, msgs, keep=40):
    """Append finished messages and trim old ones, never leaving a tool reply without its call."""
    with sess["lock"]:
        h = sess["history"]; h.extend(msgs)
        if len(h) > keep:
            tail = h[-keep:]
            while tail and tail[0]["role"] != "user":
                tail.pop(0)
            h[:] = [h[0], *tail]

def sync(sess, raw):
    """The browser is the source of truth for what's on screen."""
    try:
        s = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        s = {}
    if isinstance(s.get("clips"), list):
        sess["clips"], sess["query"] = s["clips"], s.get("query") or sess["query"]
    if isinstance(s.get("focus"), int) and sess["clips"]:
        sess["focus"] = max(0, min(s["focus"], len(sess["clips"]) - 1))
    if not sess["clips"]:
        return "no clips yet"
    c = sess["clips"][sess["focus"]]
    return (f"{len(sess['clips'])} clips for '{sess['query']}'; focused clip {sess['focus'] + 1}: {c.get('camera')} {c.get('view') or ''} at {c.get('location')}, "
            f"{c.get('start')}-{c.get('end')}s; view mode {s.get('view', 'single')}; boxes {'on' if s.get('overlay', True) else 'off'}")

def acknowledge(q, msgs):
    recent = [{"role": m["role"], "content": m["content"]} for m in msgs[-6:] if m["role"] in ("user", "assistant") and m.get("content")]
    try:
        say = oai.chat.completions.create(model=MODEL, max_tokens=30, messages=[{"role": "system", "content": ACK}, *recent]).choices[0].message.content
        if say and "SKIP" not in say:
            q.put({"type": "say", "text": say.strip(), "audio": speak(say)})
    except Exception:
        pass

def agent(sess, turn, q, ack, msgs, base):
    st = {k: sess[k] for k in ("clips", "query", "focus")}
    current = lambda: sess["turn"] == turn
    for _ in range(6):
        if not current():
            return
        msg = oai.chat.completions.create(model=MODEL, messages=msgs, tools=SCHEMA).choices[0].message
        msgs.append(msg.model_dump(exclude_none=True))
        if not msg.tool_calls:
            break
        for c in msg.tool_calls:
            args = json.loads(c.function.arguments or "{}")
            q.put({"type": "tool", "name": c.function.name, "args": args})
            try:
                out = TOOLS[c.function.name][0](st, args, q.put)
            except Exception as e:
                out = f"error: {e}"
            msgs.append({"role": "tool", "tool_call_id": c.id, "content": json.dumps(out, default=str)[:8000]})
    ack.result()
    if not current():
        return
    sess.update(st)
    remember(sess, msgs[base:])
    q.put({"type": "reply", "text": msg.content})
    if msg.content:
        q.put({"type": "audio", "audio": speak(msg.content)})

def run(sess, text, screen):
    q = queue.Queue()
    with sess["lock"]:
        sess["turn"] += 1; turn = sess["turn"]
        msgs = [*sess["history"], {"role": "user", "content": f"{text}\n\n[screen: {screen}]"}]
    yield json.dumps({"type": "heard", "text": text}) + "\n"
    ack = pool.submit(acknowledge, q, msgs)
    def work():
        try:
            agent(sess, turn, q, ack, msgs, len(msgs) - 1)
        except Exception as e:
            q.put({"type": "error", "text": str(e)[:200]})
        q.put(None)
    pool.submit(work)
    while (e := q.get()) is not None:
        yield json.dumps(e, default=str) + "\n"

# ---------- routes ----------
@app.post("/api/turn")
async def turn(audio: UploadFile = None, text: str = Form(None), screen: str = Form(None), sid: str = Form(None)):
    if audio:
        blob = await audio.read()
        r = await run_in_threadpool(httpx.post, "https://api.elevenlabs.io/v1/speech-to-text", headers=XI, timeout=60, data={"model_id": "scribe_v1"},
                                    files={"file": (audio.filename or "a.webm", blob, audio.content_type or "audio/webm")})
        text = r.json().get("text", "") if r.is_success else ""
    if not (text or "").strip():
        return StreamingResponse(iter([json.dumps({"type": "error", "text": "Sorry, I didn't catch that."}) + "\n"]), media_type="application/x-ndjson")
    sess = session(sid)
    return StreamingResponse(run(sess, text, sync(sess, screen)), media_type="application/x-ndjson")

@app.post("/api/action/{name}")
def action(name: str, body: dict):
    sess, events = session(body.get("sid")), []
    sync(sess, body.get("screen"))
    try:
        result = TOOLS[name][0](sess, body.get("args") or {}, events.append)
        remember(sess, [{"role": "user", "content": f"[I clicked {name} on screen. Result: {json.dumps(result, default=str)[:600]}]"}])
        return {"events": events}
    except Exception as e:
        return {"events": [{"type": "error", "text": str(e)[:200]}]}

@app.get("/api/detections")
def get_detections(src: str, loc: str = ""):
    try:
        return detections(src, loc)
    except Exception:
        return {"w": 1920, "h": 1080, "fps": 30, "sources": ["YOLO11"], "frames": []}

@app.get("/thumb")
def get_thumb(src: str):
    try:
        return Response(thumb(src), media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})
    except Exception:
        return Response(status_code=404)

@app.get("/api/scrub/{job}")
def scrub_status(job: str):
    info = SCRUBS.get(job, {})
    try:
        s = fal.status(FAL_MODEL, job, with_logs=False)
        if isinstance(s, fal_client.Queued):
            return {"status": "queued", "position": s.position}
        if isinstance(s, fal_client.InProgress):
            return {"status": "running", "elapsed": round(time.time() - info.get("started", time.time()))}
        r = fal.result(FAL_MODEL, job)
        url = (r.get("video") or {}).get("url") or ((r.get("videos") or [{}])[0]).get("url")
        return {"status": "done", "url": url} if url else {"status": "failed", "error": "model returned no video"}
    except Exception as e:
        return {"status": "failed", "error": str(e)[:200]}

@app.post("/api/say")
def say(body: dict):
    return {"audio": speak(body["text"])}

@app.get("/api/status")
def status():
    try:
        vss("GET", "/auth/me")
        return {"ok": True, "model": MODEL, "editor": FAL_MODEL if env.get("FAL_KEY") else None}
    except Exception:
        return {"ok": False, "model": MODEL}

@app.get("/clip")
async def clip(src: str, request: Request):
    hdrs = {"Range": request.headers["range"]} if "range" in request.headers else {}
    for attempt in range(2):
        if not token or attempt:
            await run_in_threadpool(vss, "GET", "/auth/me")
        r = await stream_http.send(stream_http.build_request("GET", "/videos/stream", params={"source": src, "token": token}, headers=hdrs), stream=True)
        if r.status_code != 401:
            break
        await r.aclose()
    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
    keep = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges")}
    return StreamingResponse(body(), status_code=r.status_code, headers=keep)

@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "index.html"))
