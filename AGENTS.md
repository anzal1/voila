# Instructions for agents

You can use voila directly — no human setup required. Everything
self-provisions on first run (Chromium, ffmpeg, the TTS model). Node >= 20.

Machine-readable version of this document: https://voila.anzalabidi.dev/llms.txt

## Use it

Via MCP (preferred — register once):

```bash
claude mcp add voila -- npx -y voila-recorder mcp
```

Tools: `voila_outline(url)` · `voila_record(url, steps_yaml?, device?, voice?, speed?)` ·
`voila_review(video_path)` · `voila_voices()` · `voila_login(url)`.

Via CLI (no registration needed):

```bash
npx -y voila-recorder outline <url>
npx -y voila-recorder record <url> --steps steps.yaml [--device mobile]
npx -y voila-recorder review demo.mp4
npx -y voila-recorder voices
npx -y voila-recorder login <url>
npx -y voila-recorder doctor
npx -y voila-recorder fork demo.mp4 [--url other] [--print]
npx -y voila-recorder rerender <dir> --voice bf_emma
```

## The loop — always follow it

1. **Outline** the page. Build selectors from the real text it returns; never guess.
2. **Write steps YAML**: every beat gets a `caption` (burned-in) and
   `narration` (spoken; segments auto-pace to the clip length — don't pad
   waits). Open and close with a `slide` title card. Mark risky steps
   `optional: true`.
3. **Record.**
4. **Review your own frames** (`voila_review`) and actually read them: cursor
   near what the narration discusses, captions not covering key UI, zooms on
   content not whitespace, every page loaded. Patch the YAML, re-record.
5. Deliver the MP4. The recipe travels inside it
   (`ffmpeg -i demo.mp4 -f ffmetadata - | grep voila-recipe`).

## Rules

- Prefer `a[href='/path']`, ids, and roles over `text=` selectors (hydration
  makes text flaky). Append `>> visible=true` when desktop and mobile nav
  duplicate elements.
- Selector failures name the failing step and include the live page outline —
  patch, don't retry blindly.
- `--device mobile` and `--device tablet` record real portrait viewports. Zoom is disabled on both because narrow layouts crop badly.
- Login-protected apps: ask the human to sign in once
  (`npx -y voila-recorder record <url> --headful` or the web UI via
  `npx -y voila-recorder serve`). The session persists in a local browser
  profile. **Never type credentials yourself.**
- Narration style: short sentences, product language, 8-15 words per beat.
- Prefer `zoom` with a `selector` over a raw `level`: voila measures the element
  and picks the level and camera centre so nothing gets cropped.
- Voices: Kokoro covers English, Spanish, French, Italian, Portuguese and
  Hindi on every platform (af_heart, ef_dora, ff_siwis, if_sara, pf_dora,
  hf_alpha). `speed` 0.5-1.6 sets pace. `voila voices` lists all 41.
- Mixing languages: set `voice:` per narration step.
- Japanese/Mandarin are gated (espeak mispronounces them). Use `--tts-cmd`
  with a dedicated engine, a macOS `say:` voice, or `audio: clip.mp3`.
- Sign-in walls: recording refuses to film a login page. Run `voila login <url>`
  (or the voila_login tool), let the HUMAN sign in in the window that opens, and
  the session persists in a local profile for every later recording.

## Working on this repo

Plain Node, CommonJS, no build step. Key files: `recorder.js` (CDP screencast,
device presets), `tour.js` (step executor + auto tour), `render.js`
(zoom-follow camera, captions), `audio.js` (Kokoro/`say` TTS), `pipeline.js`
(orchestration + recipe embedding), `review.js`, `mcp.js`, `cli.js`,
`server.js`. Smoke test: `node test.js <url>`. The `docs/` folder is the
GitHub Pages site.
