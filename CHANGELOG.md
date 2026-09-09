# Changelog

## 0.8.0

- Non-English narration on every platform. espeak-ng (WebAssembly) supplies the
  phonemes that kokoro-js could not, unlocking the 26 non-English voices the
  model already shipped: Spanish, French, Italian, Portuguese (BR) and Hindi,
  alongside English. 41 usable voices, all on-device.
- Japanese and Mandarin voices are deliberately gated: espeak leaks English
  words into kanji and emits numeric tones the model never saw. Override with
  `VOILA_EXPERIMENTAL_LANGS=1`, or use `--tts-cmd` with a dedicated engine.
- CI records a mixed-language demo on Linux, macOS and Windows.

## 0.7.0

- Narration voice is chosen per step, so one demo can switch language mid-way.
- Three engines: Kokoro, macOS system voices (`say:Name`), and any external
  engine via `--tts-cmd 'engine -f {out} "{text}"'`.
- A step can supply a ready-made clip with `audio: file.mp3`.

## 0.6.0

- `voila doctor` checks and pre-downloads Chromium and the voice model with
  visible progress, so the first run no longer looks like a hang.
- Models cache in `~/.cache/voila/models` instead of inside `node_modules`, so
  upgrades stop re-downloading 90MB.
- Cookie and consent banners are dismissed before recording, choosing "reject"
  over "accept" where both exist. `--dismiss <selector>`, `--no-dismiss`.
- `voila fork <video.mp4>` rebuilds a demo from the recipe inside the file.
  `--url` retargets it, `--print` emits the steps YAML.
- `--keep-frames` plus `voila rerender <dir>` changes voice or speed without
  re-driving the browser.
- Added `--version`.

## 0.5.0

- `zoom` accepts a `selector` and frames that element, choosing the zoom level
  and camera centre from its real box.
- A failing step is retried once; selectors wait for visibility and scroll into
  view before failing.
- `voila voices` lists every voice with quality grades; `--speed` sets pace.
- `voila login <url>` opens a browser for the person to sign in themselves, and
  recording now refuses to film a detected sign-in page.

## 0.4.0

- First public release: permission-free recording via CDP screencast, agent
  planning through MCP (`voila_outline`, `voila_record`, `voila_review`),
  on-device narration, burned-in captions, animated title slides, and the
  `voila-recipe/1` script embedded in every MP4.
