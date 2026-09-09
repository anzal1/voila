# Contributing

Thanks for taking a look. Issues and pull requests are both welcome.

## Running it locally

```bash
git clone https://github.com/anzal1/voila.git
cd voila
npm install
node cli.js doctor                      # downloads chromium + the voice model
node cli.js record https://example.com  # should produce an MP4
```

Node 20 or newer. Everything else (ffmpeg, Chromium, the TTS model) is fetched
automatically; you do not need to install them yourself.

## Layout

| file | does |
|---|---|
| `recorder.js` | owns the browser, CDP screencast, device presets |
| `tour.js` | executes steps, plus the zero-config auto tour |
| `overlay.js` | in-page cursor, click effects, title slides |
| `render.js` | replays the zoom/cursor timeline over frames into an MP4 |
| `audio.js` | narration: Kokoro, system voices, external engines |
| `phonemes.js` | espeak-ng WASM, for non-English pronunciation |
| `pipeline.js` | orchestration, recipe embedding, rerender |
| `consent.js` | cookie banner dismissal |
| `review.js` | frame extraction and recipe recovery |
| `cli.js` / `mcp.js` / `server.js` | the three interfaces |

Plain CommonJS, no build step, no TypeScript.

## Before you open a PR

```bash
node test.js https://example.com        # smoke test
node cli.js record https://example.com --steps ci-narrate.yaml --out /tmp/t
node scripts/check-audio.js /tmp/t/demo.mp4
```

CI runs on every push and records a real demo on Linux, macOS and Windows, in
English and Spanish, and verifies the narration track landed. If your change
touches recording, rendering or narration, expect CI to catch it.

## Things worth knowing

- Selectors on real sites are flaky. Prefer `a[href='/path']` and ids over text
  matching, and add `>> visible=true` when desktop and mobile nav duplicate.
- Do not add anything that sends user content off the machine. Being fully
  on-device is the point of the project.
- Japanese and Mandarin narration is gated on purpose. If you want to fix it
  properly, it needs a real G2P for those languages, not an espeak fallback.
