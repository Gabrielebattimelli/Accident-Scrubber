# SCRUBBED: a 45-second short film

*Made with Higgsfield for the Hailmary pitch and submission video.*

> **Logline:** A delivery driver clips a row of road barriers at midnight. Only a camera saw it. He
> asks an AI to erase it, and it does. By morning, the same AI tells an investigator exactly what he erased.
>
> **Theme:** every edit leaves a fingerprint. The film is the product's pitch: find, rewrite, prove.

**Runtime:** 45 s (full) · 15 s (live-pitch cold open, cut list at the end)
**Format:** 16:9, 1080p, 24 fps · **Look:** neo-noir, rain-slick sodium streets, teal-orange grade, CCTV grain for camera POVs
**Disclosure end card:** "All footage in this film is AI-generated except the app screen recordings."

---

## Characters (generate a reference image for each first, then reuse it in every shot)

| Character | Reference prompt (Higgsfield image) |
|---|---|
| **MARCO**, the driver | "Portrait of a tired man in his early 30s, stubble, dark curly hair, faded hi-vis orange jacket over a grey hoodie, night, sodium street light from the side, cinematic, 35mm, shallow depth of field" |
| **DANA REYES**, claims investigator | "Portrait of a sharp woman in her 50s, short grey hair, reading glasses, navy blazer, sitting in a bright glass office in the morning, soft daylight, cinematic, 50mm" |
| **The van** | "White unmarked delivery van, slightly dented front bumper, wet street at night, sodium lights, cinematic" |

Use Higgsfield's character-consistency/reference feature with these images in every shot where the character appears.

---

## Shot list

`T2V` = text-to-video · `I2V` = image-to-video (start from the reference or a frame of the previous shot) · `SCREEN` = screen-record the real app

| # | Time | Shot | Source | Higgsfield prompt / action | Audio |
|---|---|---|---|---|---|
| 1 | 0:00–0:04 | **EXT. CITY STREET, NIGHT.** Low tracking shot: the white van takes a wet corner too fast. | T2V | "Cinematic night city street after rain, sodium vapor lights reflecting on wet asphalt, a white delivery van takes a corner too fast, low-angle tracking shot following the van, anamorphic lens flare, teal and orange grade, film grain" · camera: low tracking | Rain, distant siren, low synth drone starts |
| 2 | 0:04–0:08 | **CCTV POV.** Fixed high-angle camera, timestamp `23:41:07`. The van clips a line of orange barriers; they scatter; it drives off. | T2V | "Grainy black-and-white-ish CCTV security camera footage, fixed high angle over a wet city street at night, timestamp overlay in the corner, a white van clips a row of orange traffic barriers which tumble across the road, the van keeps driving and leaves frame, no people" · camera: static | Muffled crunch, CCTV hum |
| 3 | 0:08–0:11 | **INT. VAN.** Close-up: Marco checks the mirror, jaw tight. | I2V (Marco ref) | "Close-up of the man from the reference driving at night, dashboard glow on his face, he glances nervously at the rear-view mirror, sweat on his temple, handheld, shallow depth of field" · camera: handheld | Engine, his breathing |
| 4 | 0:11–0:14 | **INT. MARCO'S APARTMENT, 2 AM.** Over-the-shoulder push-in to a laptop. The raccoon on screen perks its ears. | I2V (Marco ref) | "Over-the-shoulder shot of the man sitting in a dark small apartment, only lit by a laptop screen, slow push-in towards the screen" · camera: dolly-in | **MARCO (quiet):** "Find the clip where a white van hits the barriers." |
| 5 | 0:14–0:18 | **SCREEN.** The real app: the activity log shows *Search*, numbered results appear, the raccoon speaks. | SCREEN | Record the real UI (see recording note below) | **AGENT (ElevenLabs voice):** "Found it. Clip one, twenty-three forty-one." |
| 6 | 0:18–0:21 | **EXTREME CLOSE-UP.** Marco's eye, the screen reflected in it. | I2V (Marco ref) | "Extreme close-up of a man's eye reflecting a glowing laptop screen in a dark room, red light flickers in the reflection, macro lens" · camera: static macro | **MARCO:** "Edit clip one. Remove the van. Put the barriers back." |
| 7 | 0:21–0:25 | **SCREEN.** Rendering sweep, then side by side: the street is clean. The **AI-EDITED** stamp slams in. | SCREEN + T2V | Screen-record the real edit flow. For the "after" plate, generate: "Same CCTV security camera footage of an empty wet city street at night, orange traffic barriers standing neatly in a row, timestamp overlay, nothing happens" | Hard "stamp" hit. **AGENT:** "Done." |
| 8 | 0:25–0:28 | **INT. APARTMENT.** Marco exhales, closes the laptop. Darkness. | I2V (Marco ref) | "The man closes his laptop in a dark apartment, the room goes almost black, he leans back and exhales, cinematic, static wide shot" | Drone cuts to silence |
| 9 | 0:28–0:32 | **INT. GLASS OFFICE, MORNING.** Dana watches the clean clip on a monitor. Something bothers her. | I2V (Dana ref) | "The woman from the reference sitting at a desk in a bright glass office, watching security footage on a monitor, she frowns and leans in, morning daylight, slow push-in" · camera: slow push-in | Office ambience. **DANA:** "Scrubber… is this clip real?" |
| 10 | 0:32–0:39 | **SCREEN.** Authenticity report: **AI-EDITED** verdict, two fingerprints, original vs edit side by side. | SCREEN | Screen-record `verify_clip` in the real app | **AGENT:** "No. It's an edit. The original in the archive shows a white van hitting the barriers at twenty-three forty-one." |
| 11 | 0:39–0:42 | **INT. APARTMENT, MORNING.** Marco's phone lights up on the closed laptop: *"Claims: please call us about 23:41."* | T2V | "Close-up of a smartphone lying on a closed laptop on a messy desk in morning light, the phone screen lights up with a notification, shallow depth of field" | Phone buzz ×2 |
| 12 | 0:42–0:45 | **TITLE CARD.** | Editor | **HAILMARY** (logo: `public/brand/hailmary-logo-white.svg`): *Find any moment. Rewrite it. Prove what really happened.* Small: "VAST · NVIDIA Cosmos · ElevenLabs · fal" | Final synth hit |

### Recording the screen shots (5, 7, 10)
- Use the **real app on the challenge footage**, not the generated CCTV clip (generated video must never be ingested into VSS).
  The film cuts from the fictional CCTV shot to the real product UI. That's fine: shot 5 shows the *interface*, and shot 7's
  "after" plate is the generated clean street.
- Record at 1920×1080 (macOS: ⌘⇧5 → record selected portion). Hide the bookmarks bar and zoom the browser to 110%.
- Record the agent's lines straight from the app session so the voice is the product's real voice.

### Voices
- **MARCO** and **DANA:** record yourselves on a phone close to the mouth, or generate them with ElevenLabs TTS
  (pick a tired, low male voice and a crisp, older female voice).
- **AGENT:** the actual ElevenLabs agent voice from the app (`ELEVENLABS_VOICE_ID`).

---

## Higgsfield production notes

- Generate **5 s clips** and trim in the edit. Run **2–3 generations per shot** and keep the best.
- Pick whichever video model in Higgsfield gives the most realistic motion for each shot (try the top
  two available for shots 1–2; CCTV realism matters most there).
- For consistency, generate shot 2 first, then use its **last frame as the start image (I2V)** for the
  clean "after" plate in shot 7, so the framing matches exactly.
- Avoid prompts showing people being hit or injured: they'll be refused, and the story doesn't need it.

## Edit

- **Tool:** CapCut, DaVinci Resolve or iMovie. Timeline at 24 fps.
- **Music:** one low synth drone (royalty-free). Hard cut to silence at shot 8, then back for the title.
- **Grade:** teal-orange for narrative shots; desaturate and add grain plus a timestamp overlay to CCTV shots.
- **Text:** white sans for the title, monospace for CCTV timestamps and on-screen notifications.
- **Export:** 1080p H.264, with -14 LUFS loudness for the room.

## 15-second cold open (live pitch)

Shots **2 → 6 → 7 → 9 → 10 (verdict only) → 12**, ~2.5 s each:
CCTV crash → "Remove the van." → clean street + AI-EDITED → "Is this clip real?" → **AI-EDITED** verdict → title.

## Production plan (one person, ~90 min)

| Time | Task |
|---|---|
| 0:00–0:15 | Generate the 3 reference images |
| 0:15–0:55 | Generate shots 1, 2, 3, 4, 6, 8, 9, 11 (+ the clean plate for 7), 2–3 takes each |
| 0:55–1:10 | Screen-record shots 5, 7, 10 in the real app; record the voice lines |
| 1:10–1:30 | Edit, music, title card, export both cuts |
