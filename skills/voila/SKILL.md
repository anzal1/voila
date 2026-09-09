---
name: voila
description: Record a narrated, auto-zoomed product demo video of any website — no screen-recording permission, fully on-device. Use when the user asks for a product demo video, a site walkthrough recording, a narrated tour of a web app, or to recreate/fork a demo from a voila MP4/recipe. Plans with a page outline, scripts steps YAML (captions + narration + title slides), records, then self-reviews frames and iterates.
---

# voila — agent-recorded product demos

voila renders a site in its own Chromium and records the viewport (CDP
screencast) — the user never grants screen-recording permission and nothing
leaves the machine. ffmpeg is bundled, the Kokoro TTS model and Chromium
download themselves on first use. The user installs nothing (Node >= 20).

Prefer the MCP tools if registered (`voila_outline`, `voila_record`,
`voila_review`); otherwise use the CLI via npx:

```bash
npx -y voila-recorder doctor            # first run: pre-downloads chromium + voice model
npx -y voila-recorder outline <url>
npx -y voila-recorder record <url> --steps steps.yaml [--device mobile]
npx -y voila-recorder review demo.mp4
npx -y voila-recorder fork demo.mp4 --url https://other.example
npx -y voila-recorder rerender <dir> --voice bf_emma
```

Register the MCP server once with: `claude mcp add voila -- npx -y voila-recorder mcp`
Reference: https://voila.anzalabidi.dev/llms.txt · https://github.com/anzal1/voila

## Workflow — always this loop

1. **Outline first** → real nav text, headings, CTAs. Build selectors from it;
   never guess.
2. **Write steps YAML**. Every meaningful beat gets a `caption` (burned-in
   lower-third) and `narration` (spoken; the recording auto-paces to each
   clip's length — do NOT pad waits for narration). Open and close with a
   `slide` (animated title card: `title`, `subtitle`, `accent` hex).
   Actions: goto, click, hover, type, scroll (y), scroll_to (selector),
   slide, zoom (level OR selector to frame an element), wait. Mark risky steps
   `optional: true`.
3. **Record** (`voila_record` / `record --steps`).
4. **Review your own output** (`voila_review`) → frames + timeline. Read the
   frames. Check: cursor near what narration discusses; captions not covering
   key UI; zooms centered on content, not whitespace; every page actually
   loaded; no dead segments. Patch the YAML, re-record. One review pass
   minimum before delivering.
5. Deliver the MP4 (the recipe travels inside it — extract from any voila MP4
   with `ffmpeg -i demo.mp4 -f ffmetadata -`).

## Hard-won rules

- Selectors: prefer `a[href='/path']`, roles, and ids over text= (hydration
  makes text selectors flaky). Append `>> visible=true` when duplicates exist
  (desktop + mobile nav).
- On selector failure the error includes the live page outline — use it to
  patch, don't retry blindly.
- Devices: desktop (1280x800), mobile (390x844, iPhone emulation), tablet
  (834x1112). Zoom is auto-disabled on mobile and tablet because narrow
  layouts crop badly; both output portrait.
- Zoom levels 1.3–1.6 on desktop; always return to 1 before ending.
- Login-protected apps: recording a sign-in page is refused with a clear error.
  Run `voila login <url>` (or the voila_login tool): a real browser window
  opens, the USER signs in themselves, and the session is saved to a local
  Chromium profile every later recording reuses. Use `--profile <dir>` for
  separate logins per product. NEVER type credentials yourself and never ask
  for them in chat.
- Prefer `zoom` with a `selector` over a bare `level`: voila measures the
  element and picks the level and camera centre, so nothing is cropped.
- Languages: narration voice is per step, so demos can mix languages freely.
  Kokoro covers English (af_heart A, af_bella A-, bf_emma British), Spanish
  (ef_dora), French (ff_siwis), Italian (if_sara), Portuguese (pf_dora) and
  Hindi (hf_alpha) on EVERY platform, on-device. `voila voices` lists all 41.
  Japanese and Mandarin voices are gated because espeak mispronounces them;
  for those use `--tts-cmd` with a dedicated engine, a macOS system voice
  (`voice: "say:Kyoko"`, see `voila voices --all`), or `audio: clip.mp3`.
- Voices: `voila voices` lists the English voices with quality grades. af_heart
  (A) default, af_bella (A-), af_nicole (B-), bf_emma (B-, British). `--speed`
  or the speed param (0.5-1.6) changes pace; 0.9 reads calmer.
- A failing step is retried once automatically; warnings appear in the result.
- Iterating on narration? Record once with `--keep-frames`, then `rerender <dir>
  --voice x --speed n`. It skips the browser entirely and finishes in seconds.
- Consent banners are auto-dismissed (reject preferred over accept). Use
  `--dismiss <selector>` for an unusual one, `--no-dismiss` to leave it alone.
- First run on a new machine downloads ~240MB. Run `voila doctor` first and tell
  the user it is downloading, so it does not look frozen.
- `fork <video.mp4>` rebuilds any voila demo from the recipe inside the file.
- Narration style: short sentences, product language, no "as you can see".
  8–15 words per beat reads best at Kokoro's pace.
