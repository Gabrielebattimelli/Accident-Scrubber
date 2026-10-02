# Live demo: 2 minutes, word for word

**Setup before you go on:** app open and session **already started** (Agent panel says Listening), mic tested,
activity log empty, one edit **pre-rendered** as a fallback (e.g. `e1`), the short film cued in another tab,
laptop volume up.

| Time | Who | Say / do | Screen |
|---|---|---|---|
| 0:00 | Film | Play the 15 s cut of *SCRUBBED* (see [SHORT_FILM.md](SHORT_FILM.md)) | Film ends on "AI-EDITED" |
| 0:15 | Presenter | "Generative video editing is now one sentence away. We built the agent that does it, on top of a real archive, and made it prove what it changed." | Agent listening |
| 0:25 | Presenter → agent | **"Find a truck changing lanes on the highway."** | Search in the activity log (VSS · Cosmos Embed), numbered results appear, best one plays |
| 0:40 | Presenter → agent | **"What colour is the truck in clip one?"** | look_closer: Cosmos3-Reason watches the mp4 |
| 0:50 | Presenter → agent | **"Edit clip one. Remove the truck. Empty lane."** | W&B → fal, render progress in the right pane, provenance in the inspector |
| 0:55 | Presenter | While it renders: "Every edit goes to a ledger with a fingerprint of the original in VAST. Originals are read-only." | |
| 1:20 | Agent | (system notice) "Done. The truck is gone." | Original and edit side by side, edit labelled AI-EDITED |
| 1:30 | Presenter → agent | **"Is this clip real?"** | verify_clip: AI-edited verdict in the inspector, both SHA-256s, what Cosmos saw in each |
| 1:45 | Presenter | "Search, understand, rewrite, prove. One voice, on VAST and Cosmos. Hailmary." | |

**If the render is slow:** say "here's one we rendered a minute ago" → **"Show edit one."**
**If the mic dies:** type the same lines into the message box in the Agent panel. It's the same agent.
**If Wi-Fi dies:** play the backup screen recording.

## Judge Q&A

- **"Isn't this a tool for faking evidence?"** It's the opposite. The edit is the easy part; anyone can
  do it on fal today. What archives lack is the ability to prove what the original showed. Originals
  stay read-only in VAST, every edit is fingerprinted and labelled, and one sentence verifies any clip.
- **Real-world uses:** redacting bystanders or plates before footage is released; insurance and claims
  teams checking submitted clips against the source archive; newsrooms verifying UGC; synthetic
  variations for training perception models (the NVIDIA Cosmos story).
- **What does Cosmos do here?** It wrote the captions at ingest that make search work (Embed1 +
  Reason). Live, it answers detail questions on the actual mp4 and writes the forensic descriptions of
  original vs edit.
- **Why ElevenLabs client tools?** No public webhook is needed from the VM, keys stay server-side, and
  each tool result updates the screen instantly.
- **Scale:** search is VastDB vectors + captions, so it doesn't care whether there are 300 clips or 3 million.
  The ledger becomes a VastDB table in production.
- **What we'd do next:** C2PA manifests on every edit; write the ledger into VastDB next to the segment
  rows; on-prem editing with Cosmos Transfer instead of a cloud model.
