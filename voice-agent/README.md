# Sightline — voice copilot over the VSS archive

Talk to it like a coworker: it searches every camera, puts the moment on screen with AI boxes, pulls up the same moment from another camera, scrubs the clip with a generative video model, and files incidents into a case file.

- `app.py`: FastAPI server.
  - Voice: ElevenLabs Scribe (speech-to-text) and Flash (voice "Sarah").
  - Agent: a tool-calling loop on OpenAI `gpt-4.1-mini`, falling back to W&B `gpt-oss-120b`. A parallel call speaks a short acknowledgment right away. The tools drive the UI: search, focus, boxes, seek, other angle, scrub, file incident, archive Q&A.
  - Boxes: YOLO11 from VSS `/videos/detections`, plus Cosmos3-Reason grounding for forklifts, AGVs and robots, which YOLO can't detect.
  - Scrub: fal, default `minimax/h3/reference-to-video` (about 20 s for a 5 s clip at 768p). Set `FAL_EDIT_MODEL=google/gemini-omni-flash/v1.1/edit` for a more faithful but slower (about 75 s) edit.
  - `/clip` proxies VSS video and `/thumb` serves still thumbnails, so the JWT never reaches the browser.
- `index.html`: the whole UI, a single file with no build step. The orb is a Three.js noise-displaced sphere driven by mic and voice volume.

Each browser tab gets its own session. The browser sends the clips it's showing with every request, so "this one" always means what's on screen.

## Run

```bash
cd voice-agent
cp .env.example .env   # fill in keys (or rely on the repo-root .env / VM /config)
uv run uvicorn app:app --port 8765
```

Open http://localhost:8765. The microphone needs `localhost` or HTTPS.

## Share a public link

```bash
cloudflared tunnel --url http://localhost:8765   # prints an https://*.trycloudflare.com URL
```

Anyone with the link can use it and spend your API credits. Quick-tunnel URLs change whenever the tunnel restarts.
