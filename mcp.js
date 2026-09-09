#!/usr/bin/env node
// voila MCP server — lets any MCP client (Claude Code, Desktop, Cursor…) plan,
// record, and review narrated, auto-zoomed product demos. Headless by default.
//
// Register: claude mcp add voila -- node /path/to/voila/mcp.js

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { VoilaSession } = require('./recorder');
const { produceDemo, outline } = require('./pipeline');
const { reviewDemo } = require('./review');
const voiceCatalogue = require('./voices');

// One persistent Chromium profile can't be opened twice, so browser work is
// serialized through a queue: concurrent tool calls wait instead of colliding.
const sessions = new Map();
let chain = Promise.resolve();
const enqueue = fn => {
  const p = chain.then(fn, fn);
  chain = p.then(() => {}, () => {});
  return p;
};

function getSession(device) {
  const key = device || 'desktop';
  if (!sessions.has(key)) {
    sessions.set(key, new VoilaSession({
      headless: process.env.VOILA_HEADFUL !== '1',
      device: key,
      profileDir: (process.env.VOILA_PROFILE || path.join(__dirname, 'profile')) + (key === 'desktop' ? '' : `-${key}`),
    }));
  }
  return sessions.get(key);
}

const server = new McpServer({ name: 'voila', version: '0.8.0' });
const deviceParam = z.enum(['desktop', 'mobile', 'tablet']).optional().default('desktop');

server.tool(
  'voila_outline',
  'Get a structural outline of a web page (title, description, nav links, headings, buttons/CTAs). ' +
  'Use this first to plan a demo script: the outline gives you real text to build selectors from ' +
  '(e.g. "text=Leaderboard") and content for captions/narration.',
  { url: z.string().url(), device: deviceParam },
  async ({ url, device }) => enqueue(async () => ({
    content: [{ type: 'text', text: JSON.stringify(await outline(getSession(device), url), null, 2) }],
  }))
);

server.tool(
  'voila_record',
  'Record a crisp, auto-zoomed MP4 demo of a website — no screen capture, no permissions. ' +
  'Without steps_yaml it runs a generic auto-tour. For a proper demo, pass steps_yaml: a YAML list of ' +
  '{action, selector?, url?, text?, title?, subtitle?, accent?, level?, ms?, caption?, narration?, optional?}. ' +
  'Actions: goto, click, hover, type, scroll, scroll_to, slide (animated full-screen title card: title/subtitle/accent), zoom, wait. '  +
  'zoom accepts either level (1-3) or, better, selector: it then frames that element, choosing the level and camera centre for you. ' +
  'caption is burned into the video as a lower-third; narration is spoken via on-device TTS (Kokoro) at that step, ' +
  'and segment pacing automatically stretches to fit each narration clip — no need to pad waits. ' +
  'Steps marked optional:true are skipped on failure instead of aborting. ' +
  'A step may set its own voice: (mixing languages within one demo) or audio: (a ready-made clip). ' +
  'device selects the recorded viewport (mobile emulates an iPhone-class device). ' +
  'On failure the error names the failing step and includes the live page outline — patch the steps and retry. ' +
  'Returns the MP4 path, the recipe path, and any warnings.',
  {
    url: z.string().url(),
    steps_yaml: z.string().optional(),
    narrate: z.boolean().optional().default(true),
    voice: z.string().optional().describe('default narration voice. Kokoro speaks English (af_heart, af_bella, bf_emma), Spanish (ef_dora), French (ff_siwis), Italian (if_sara), Portuguese (pf_dora) and Hindi (hf_alpha) on every platform. Per-step `voice:` overrides this, so one demo can mix languages. Japanese/Mandarin are gated (mispronounced) - use tts_cmd for those.'),
    speed: z.number().min(0.5).max(1.6).optional().default(1).describe('narration speed; 0.9 reads calmer'),
    tts_cmd: z.string().optional().describe('external TTS engine template for any language/platform, e.g. \'piper -m es.onnx -f {out} -- "{text}"\'. Placeholders: {out} {text} {voice}.'),
    device: deviceParam,
  },
  async ({ url, steps_yaml, narrate, voice, speed, tts_cmd, device }) => enqueue(async () => {
    const steps = steps_yaml ? yaml.load(steps_yaml) : null;
    const workDir = path.join(__dirname, 'recordings', `mcp-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    const result = await produceDemo(getSession(device), {
      url, steps, workDir, narrate, voice: voice || null, speed, ttsCmd: tts_cmd || null,
      onStatus: () => {},
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          video: result.video,
          recipe: result.recipe,
          durationSec: Math.round((result.meta.tEnd - result.meta.tStart) / 1000),
          narrated: result.narration.narrated,
          voice: result.narration.voice || null,
          device: result.meta.device,
          segments: (result.meta.segments || []).length,
          warnings: result.meta.warnings || [],
        }, null, 2),
      }],
    };
  })
);

server.tool(
  'voila_review',
  'Review a finished demo: extracts evenly spaced PNG frames plus the segment timeline and embedded recipe. ' +
  'Read the returned frame files and check: is the cursor near what the narration discusses? do captions overlap ' +
  'important UI? is any zoom centered on whitespace? did a page fail to load? does a segment linger with nothing ' +
  'happening? Then patch the steps YAML and call voila_record again. Works on any voila MP4, including ones ' +
  'received from other people (the recipe travels inside the file).',
  {
    video_path: z.string(),
    frame_count: z.number().int().min(3).max(40).optional().default(12),
  },
  async ({ video_path, frame_count }) => ({
    content: [{ type: 'text', text: JSON.stringify(await reviewDemo(video_path, { count: frame_count }), null, 2) }],
  })
);

server.tool(
  'voila_voices',
  'List narration voices. Kokoro covers English, Spanish, French, Italian, Portuguese and Hindi on ' +
  'every platform, on-device; English voices carry quality grades. Japanese and Mandarin voices exist ' +
  'but are gated because espeak mispronounces them. Pass system:true to also list the machine\'s own ' +
  'voices (macOS). Use before voila_record when the user asks for a different voice, an accent, a male ' +
  'or female narrator, or a non-English language.',
  { system: z.boolean().optional().default(false) },
  async ({ system }) => ({
    content: [{ type: 'text', text: JSON.stringify({
      kokoro: voiceCatalogue.ranked(),
      languages: 'English (US/UK), Spanish, French, Italian, Portuguese (BR), Hindi',
      gated: 'Japanese and Mandarin: espeak mispronounces them; use tts_cmd or a system voice',
      system: system ? voiceCatalogue.systemVoices() : undefined,
      systemLanguages: system ? Object.keys(voiceCatalogue.systemLanguages()) : undefined,
      note: 'Set voice: per step to mix languages in one demo.',
    }, null, 2) }],
  })
);

server.tool(
  'voila_login',
  'Open a real browser window so the PERSON can sign in to their product themselves. The session is ' +
  'saved to a local Chromium profile and every later recording of that site is already logged in. ' +
  'Call this when voila_record fails saying it hit a sign-in page. voila never sees or types ' +
  'credentials: you are only opening the window for the human. Requires a desktop session; tell the ' +
  'user to watch for the window.',
  { url: z.string().url(), device: deviceParam },
  async ({ url, device }) => enqueue(async () => {
    const s = getSession(device);
    const { login } = require('./auth');
    const r = await login(s, url);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        result: r.reason, profile: r.profileDir, endedOn: r.finalUrl,
        next: 'Re-run voila_record; the recording will reuse this signed-in profile.',
      }, null, 2) }],
    };
  })
);

(async () => {
  await server.connect(new StdioServerTransport());
})().catch(e => { console.error(e); process.exit(1); });
