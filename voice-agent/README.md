# Sightline — voice search over the VSS archive

Hold the orb (or Space), ask for footage out loud, and get a spoken answer with the matching clips playing on screen.

- `app.py`: FastAPI server, about 100 lines. Speech-to-text is ElevenLabs Scribe and the voice is ElevenLabs Flash. The agent is a tool-calling loop (OpenAI `gpt-4o-mini`, falling back to W&B `gpt-oss-120b`) over the VSS APIs: `search`, `agent/ask`, `videos/synthesize` and `metadata/values`. `/clip` proxies VSS video streams so the JWT never reaches the browser.
- `index.html`: the whole UI, a single file with no build step. The orb is a Three.js noise-displaced sphere driven by mic and voice volume, with a CSS fallback when WebGL is unavailable.

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

Anyone with the link can use it and spend your API credits, and everyone shares one conversation history.
