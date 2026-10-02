<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/hailmary-logo-white.svg">
    <img alt="Hailmary" src="public/brand/hailmary-logo-black.svg" height="40">
  </picture>
</h1>

**Talk to your footage.** A voice agent wired into a live video archive. Ask for any moment in
plain speech and it finds the clip across every camera. Tell it to change the clip and it re-renders
it with a generative video model. Ask whether a clip is real and it proves what happened, using the
untouched original stored in VAST.

> *Find any moment. Rewrite it with one sentence. Prove what really happened.*

Built in one day at the **VAST Builders Challenge** (SF, Oct 2 2026) on VAST + NVIDIA Cosmos + YOLO11
+ W&B Inference, with **ElevenLabs Agents** for voice and **fal** for video editing.

---

## What it does

| | You say | What happens |
|---|---|---|
| **Find** | “Find a truck changing lanes on the highway.” | Hybrid text + visual search (Cosmos Embed) over every indexed camera on VAST. Numbered clips fly into the reel and the best one plays. |
| **Understand** | “What colour is the car in clip three?” | NVIDIA **Cosmos3-Reason** watches the actual segment and answers. YOLO11 counts objects. The VSS agent answers archive-wide questions. |
| **See** | “Was anyone too close to the forklift? Follow it.” | YOLO11 boxes for people and vehicles, plus **Cosmos3-Reason grounding** for forklifts, AGVs and robots that YOLO can't see. Objects are tracked with ids ("forklift 1"), and the agent can zoom and follow one. An object timeline sits under the video. |
| **Compare** | “Show me the other angle.” | The same moment from another camera of the scene, side by side in sync. Or a grid of results, or any two clips. |
| **Rewrite** | “Edit clip one: remove the truck.” | W&B Inference (gpt-oss-120b) turns the request into a precise edit instruction. The segment goes to **fal** (MiniMax H3 by default, about 20 s) and comes back as an AI-EDITED copy on a **before/after wipe slider** over the original. |
| **Prove** | “Is that clip real?” | The authenticity check compares SHA-256 fingerprints of the original in VAST and the edit, has Cosmos describe both, and reports **exactly what was changed**. |

The point of the demo: **generative video editing is now one sentence away, and that's both
useful and dangerous.** An archive that can be searched and edited also has to be able to prove what
the original showed. Originals are never modified. Every edit is a labelled copy recorded in a
provenance ledger.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser · Next.js 16 + Tailwind v4"]
    MIC(("🎙 user")) --> EL["ElevenLabs Agent<br/>(WebRTC, client tools)"]
    EL -- tool call --> TB["useAgentTools<br/>clip 3 → s3 source"]
    TB --> UI["Agent panel · Viewer · Results · Inspector"]
  end

  TB -- POST /api/tools/* --> API

  subgraph Server["Next.js route handlers"]
    API["tools-server.ts"]
    VID["/api/video<br/>Range proxy"]
    ED["/api/edits/:id<br/>poll + hash"]
    LEDGER[(".data/ledger.json<br/>provenance")]
  end

  subgraph VAST["Team VSS stack (pre-deployed)"]
    VSS["VSS backend /api/v1<br/>search · agent/ask · synthesize · detections"]
    DB[("VastDB<br/>captions + 256-d vectors")]
    S3[("VAST S3<br/>original segments")]
    VSS --- DB
    VSS --- S3
  end

  subgraph GPU["CoreWeave GPUs"]
    COS["Cosmos3-Reason"]
    YOLO["YOLO11"]
  end

  API --> VSS
  API --> COS
  API --> YOLO
  API --> WB["W&B Inference<br/>gpt-oss-120b<br/>edit-prompt polish"]
  API --> FAL["fal queue<br/>Gemini Omni Flash Edit"]
  ED --> FAL
  API --- LEDGER
  ED --- LEDGER
  VID --> VSS
  UI -- "<video>" --> VID
```

More detail, including sequence diagrams for find, edit and prove: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### How each piece of the stack is used

| Component | Role in Hailmary |
|---|---|
| **VAST S3 + VastDB** | Holds the original ~5 s segments, their Cosmos captions and embeddings. It's the source of truth the authenticity check hashes against. |
| **VSS backend** | `POST /search` (hybrid search + LLM synthesis), `POST /agent/ask`, `POST /videos/synthesize`, `GET /videos/detections`, `GET /videos/stream` |
| **NVIDIA Cosmos Embed1** | Powers the hybrid text/visual search behind every "find" request |
| **NVIDIA Cosmos3-Reason** | Ingest captions, plus live "look closer" questions and the forensic descriptions of original vs edit |
| **YOLO11** | Object boxes per frame (pipeline sidecar, live fallback), linked into tracks |
| **Cosmos3-Reason grounding** | Forklift / AGV / robot boxes on 2 fps frames (needs `ffmpeg`), interpolated onto every YOLO frame |
| **W&B Inference** (CoreWeave) | Rewrites spoken edit requests into precise, preservation-aware instructions |
| **ElevenLabs Agents** | Speech-to-speech agent with 23 client tools that drive the whole screen, WebRTC, low latency |
| **fal** | Queue-based video-to-video editing (`FAL_EDIT_MODEL`, MiniMax H3 reference-to-video by default) |
| **Cursor** | Used to build and run everything on the workshop VM |

### The agent's tools

Defined in [agent/tools.json](agent/tools.json), handled in [components/useAgentTools.ts](components/useAgentTools.ts),
executed in [lib/tools-server.ts](lib/tools-server.ts).

| Tool | Backed by | Notes |
|---|---|---|
| `search_archive` | VSS `/search` | Optional `camera_id` / `location` filters. Best hit auto-plays. |
| `ask_archive` | VSS `/agent/ask` | Optionally scoped to one clip's parent video |
| `list_cameras` | VSS `/metadata/schema` | Lets the agent pick valid filters |
| `show_clip` | UI only | Clip or edit (before/after) on the main screen |
| `look_closer` | Cosmos3-Reason | Watches the real mp4 (4 fps) |
| `detect_objects` | YOLO11 | Max count per class per frame |
| `summarize_video` | VSS `/videos/synthesize` | Timeline of the parent video |
| `edit_clip` | W&B → fal | Returns immediately; a background poll notifies the agent when the render is ready |
| `check_edit` | ledger | Status of a render |
| `verify_clip` | ledger + Cosmos3-Reason | Verdict, fingerprints, what Cosmos sees in each version |
| `compare_angles` | VSS `/search` | Same moment, another camera of the scene, synced side by side |
| `set_layout` | UI only | `single`, `grid` of clips, or `compare` two clips in sync |
| `playback` | UI only | Play, pause, restart, slow motion, any speed |
| `zoom` | UI only | Zoom on a region, or follow a tracked object like a camera operator |
| `annotate` / `set_caption` | UI only | Callouts pinned to objects; a lower-third headline |
| `mark_moment` | UI only | Clickable markers on the object timeline |
| `show_card` | UI only | Generated UI cards on the board: stats, bar chart, checklist, clickable moments, clip shortlist |
| `clear_screen` / `get_screen` | UI only | Tidy up; read back exactly what the user sees |

What the user changes by hand (opening a clip, toggling boxes, following an object) is sent to the agent as a silent `[screen]` contextual update, so "this one" always means what is on screen.

---

## Run it on the VAST workshop VM

Nothing VM-specific needs configuring. The server reads the VSS login and GPU token from
`/config/<team>.config`, the Cosmos and YOLO endpoints (and the served Cosmos model id) from
`/config/<team>-vss2-secret.yaml`, and W&B from the exported environment. Explicit env vars
always win. You only add two keys.

```bash
# 0. Node 20.9+ (check; install with nvm if missing)
node -v || (curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && . ~/.nvm/nvm.sh && nvm install 22)

# 1. Get the code
git clone https://github.com/Gabrielebattimelli/Accident-Scrubber.git && cd Accident-Scrubber
npm ci

# 2. Keys (never commit .env.local)
cp .env.example .env.local
#    → fill ELEVENLABS_API_KEY and FAL_KEY (FAL_AI_API_KEY also works)

# 3. Create the ElevenLabs agent + its 23 client tools (idempotent; re-run after editing agent/*)
npm run agent:setup
#    → saves ELEVENLABS_AGENT_ID into .env.local on first run

# 4. Run
npm run build && npm start        # or: npm run dev
```

Then check the wiring before you talk to it:

```bash
curl -s localhost:3000/api/health          # live check of every service; each line should start with "ok"
curl -s "localhost:3000/api/debug?q=truck" # raw VSS search + how it was normalised
npm run smoke                              # runs every agent tool end to end (add -- --edit for a real fal render)
```

If `/config` lives somewhere else, point `VM_CONFIG_DIR` at it.

### Microphone (read this first)

Browsers only allow the mic on **https** or **localhost**. Pick one:

1. **VM browser:** open `http://localhost:3000` inside the VM desktop, if it forwards your laptop's mic.
2. **HTTPS tunnel to your laptop (most reliable):** run one of these on the VM and open the printed `https://` URL on your laptop.
   ```bash
   ssh -R 80:localhost:3000 nokey@localhost.run
   # or
   npx cloudflared tunnel --url http://localhost:3000
   ```
3. **Team ingress at `/app`:** see the deploy section. It's served over http, so in Chrome on your laptop enable
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure` for `http://video-lab-team-<N>.cosmos.vastdata.com`.

No mic at all? Type into the message box at the bottom of the Agent panel. Typed messages go to the same agent.

### Deploy to the team host at `/app`

```bash
./deploy/k8s.sh                                           # needs kubectl; keys come from .env.local
kubectl -n "$USERNAME" logs -f deploy/accident-scrubber   # builds in the pod, 2–4 min
```

This follows the `deploy-app-no-registry` skill: there's no Docker build. The source ships in a ConfigMap and is built
inside `node:22-slim` with `NEXT_PUBLIC_BASE_PATH=/app`.

---

## Configuration

See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `VSS_URL` / `INGRESS_URL` | from VM | VSS backend base URL |
| `VSS_USERNAME` / `USERNAME`, `VSS_PASSWORD` / `PASSWORD` | from VM | VSS login |
| `COSMOS3_REASON_URL`, `GPU_BEARER_TOKEN`, `YOLO_URL` | from VM | Direct GPU endpoints |
| `COSMOS3_REASON_MODEL` | from VM, else asked from `/v1/models` | Cosmos model id (`nvidia/cosmos3-nano-reasoner` on the workshop stack) |
| `VM_CONFIG_DIR` | `/config` | Where the VM config files are read from |
| `WANDB_API_KEY`, `WANDB_TEAM`, `WANDB_PROJECT` | from VM | Edit-prompt polishing (optional) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | **add** | Voice agent |
| `ELEVENLABS_LLM` | `gemini-3.8-flash` | Agent brain. Newest Flash for voice latency; `claude-sonnet-5-5` if multi-step tool chains need more precision |
| `ELEVENLABS_REASONING_EFFORT` | `low` | Short thinking keeps turn-taking snappy (ElevenLabs guidance for voice) |
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | Agent voice, used by `agent:setup` |
| `NEXT_PUBLIC_VOICE_TRANSPORT` | `webrtc` | `websocket` if WebRTC is blocked on the network |
| `FAL_KEY` | **add** | Video editing |
| `FAL_EDIT_MODEL` | `minimax/h3/reference-to-video` | About 20 s per clip. `google/gemini-omni-flash/v1.1/edit` is more faithful but about 75 s; any `{prompt, video_url}` endpoint works |
| `FAL_EDIT_RESOLUTION` | `768P` | MiniMax: `480P` (about 2x faster) / `768P`. Gemini Omni: `360p` / `720p` / `1080p` / `4k` |
| `FAL_EDIT_EXTRA_JSON` | none | Extra JSON merged into the fal input |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Microphone unavailable” | Not a secure context. Use localhost or a tunnel (see Microphone). |
| Agent talks but never calls tools | Re-run `npm run agent:setup`, and check that the agent ID in `.env.local` is the one it printed |
| `TOOL ERROR: VSS login failed (401)` | Check `/config/<team>.config` is readable, or set `VSS_USERNAME` / `VSS_PASSWORD` |
| Search finds clips but they have no camera or caption | Open `/api/debug?q=...` and match field names in [lib/clips.ts](lib/clips.ts) |
| Clips don't play | Open `/api/video?source=<s3 uri>` directly; check the VSS token and segment URI |
| Edit stuck on “rendering” | `curl localhost:3000/api/edits/e1`. fal queue position is in the response. Try `FAL_EDIT_RESOLUTION=360p` for speed. |
| WebRTC won't connect on venue Wi-Fi | `NEXT_PUBLIC_VOICE_TRANSPORT=websocket`, rebuild |

---

## Responsible by design

- **Originals are read-only.** The app never writes to the archive. Edits are new files on fal's CDN.
- **Every edit is labelled.** AI-EDITED stamp on screen, edit IDs in speech, and a ledger entry with
  SHA-256 of the original and the output, the user's words, the exact prompt sent, and the model.
- **The agent won't pass an edit off as original.** That's a hard rule in [agent/prompt.md](agent/prompt.md),
  and `verify_clip` is one sentence away for anyone who asks.
- **Footage:** only the challenge's provided, licensed corpus is used. Generated clips are never ingested back into VSS.

---

## Repo layout

```
agent/            ElevenLabs agent: prompt.md + tools.json (source of truth for agent:setup)
app/api/          tools/[name] · video · edits/[id] · voice/token · health · debug
components/       Studio (layout) · TopBar · AgentPanel + Raccoon · Stage (viewer) · ClipReel · Inspector · ActivityFeed · Brand · ui (primitives) · useAgentTools · store
public/brand/     Hailmary logo, mark and app icon (SVG: white, black, and auto light/dark)
lib/              env, vss, clips, cosmos, detections, edit (fal), polish (W&B), ledger, types
scripts/          setup-agent.mjs: upserts tools + agent through the ElevenLabs API
deploy/k8s.sh     no-registry deploy to /app on the team host
docs/             ARCHITECTURE.md · DEMO.md · SHORT_FILM.md
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): sequence diagrams, data shapes, design decisions
- [docs/DEMO.md](docs/DEMO.md): the 2-minute live demo, word for word, plus judge Q&A
- [docs/SHORT_FILM.md](docs/SHORT_FILM.md): *SCRUBBED*, the Higgsfield short film script and shot list
