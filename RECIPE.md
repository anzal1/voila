# voila-recipe/1 — demos as code

Every voila MP4 carries its own source. The **recipe** is a JSON document
describing how the video was made — enough for any agent (or human) to
recreate, fork, or update the demo without ever seeing the original project.

## Where it lives

1. **Inside the MP4** — the QuickTime/MP4 `comment` metadata atom, prefixed
   `voila-recipe:`. Extract it with stock ffmpeg:

   ```bash
   ffmpeg -i demo.mp4 -f ffmetadata - 2>/dev/null | grep -o 'voila-recipe:.*'
   ```

2. **Sidecar** — `recipe.json` written next to the MP4 at produce time.

The embedded copy is authoritative for shared files: it survives renames,
uploads, and downloads, because it *is part of the video file*.

## Schema

```jsonc
{
  "tool": "voila",
  "spec": "voila-recipe/1",        // this document's version
  "url": "https://example.com",    // where the demo was recorded
  "mode": "steps",                 // "steps" (scripted) or "auto" (heuristic tour)
  "steps": [ /* the script, or null in auto mode — see Actions */ ],
  "durationSec": 65,
  "segments": [                    // narration/caption timeline as recorded
    { "at": 5.2, "caption": "Talent is a market", "narration": "Claim your card…" }
  ],
  "howToRecreate": "…human/agent-readable pointer to voila…"
}
```

## Actions (steps mode)

Each step: `{ action, ...params, caption?, narration?, optional?, pause? }`

| action      | params                              | effect |
|-------------|-------------------------------------|--------|
| `goto`      | `url`                               | navigate; cursor drifts to salient content |
| `click`     | `selector` (Playwright), `ms`       | move cursor → highlight ring → press + ripple → click |
| `hover`     | `selector`, `ms`                    | move cursor onto the element |
| `type`      | `selector`, `text`, `delay`         | click then type with human cadence |
| `scroll`    | `y` (absolute px), `ms`             | eased scroll |
| `scroll_to` | `selector`, `ms`                    | eased scroll until element is in view |
| `slide`     | `title`, `subtitle?`, `accent?`, `ms?` | full-screen animated title card |
| `zoom`      | `level` (1-3) or `selector`, `ms`   | camera zoom; with a selector it frames that element |
| `wait`      | `ms`                                | hold (cursor keeps breathing on long holds) |

Any step may also carry `voice:` (Kokoro id, `say:Name`, or an id for your
`--tts-cmd` engine) and `audio:` (a ready-made clip, skipping TTS entirely).
Because voice is per step, a recipe can mix languages.

`caption` renders as a lower-third; `narration` is spoken by on-device TTS and
**paces the segment** — the recording holds until the clip finishes, so a
recreated demo re-times itself to whatever voice regenerates it.
`optional: true` skips the step on failure instead of aborting.

## Recreating

With the recipe extracted, any agent can rebuild the demo:

- **MCP**: `voila_record({ url, steps_yaml })` — steps serialized back to YAML.
- **CLI**: `voila record <url> --steps recipe-steps.yaml`

Selectors may need patching if the target site changed — that is the point:
the recipe is diffable source, the video is a build artifact. Use
`voila_review` / `voila review` to inspect a rebuilt video frame by frame.
