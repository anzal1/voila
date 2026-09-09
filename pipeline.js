// One entry point for the full record -> render -> narrate pipeline,
// shared by the web server, CLI, and MCP server.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { VoilaSession } = require('./recorder');
const { render } = require('./render');
const { addNarration, prepareNarration } = require('./audio');
const { extractOutline } = require('./tour');

// The recipe is the demo's source code: enough for any agent to recreate or
// fork the video. Written as a sidecar (recipe.json) AND embedded in the
// MP4's comment metadata, so the recipe travels with the shared file.
function buildRecipe({ url, mode, steps, meta }) {
  return {
    tool: 'voila',
    spec: 'voila-recipe/1',
    url,
    mode: steps ? 'steps' : mode,
    steps: steps ? steps.map(s => Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('_')))) : null,
    durationSec: Math.round((meta.tEnd - meta.tStart) / 1000),
    segments: (meta.segments || []).map(s => ({
      at: +((s.t - meta.tStart) / 1000).toFixed(2),
      caption: s.caption,
      narration: s.narration,
    })),
    howToRecreate: 'Run the steps against the url with voila (github.com/anzal1/voila) — voila_record(url, steps_yaml) via MCP, or `voila record <url> --steps <file>`.',
  };
}

function embedRecipe(videoIn, videoOut, recipe) {
  return new Promise((res, rej) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-i', videoIn, '-c', 'copy', '-movflags', '+faststart',
      '-metadata', `comment=voila-recipe:${JSON.stringify(recipe)}`,
      videoOut,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg embed exited ${code}\n${err.slice(-1000)}`))));
    ff.on('error', rej);
  });
}

async function produceDemo(session, { url, mode = 'auto', steps = null, workDir, voice = null, speed = 1, narrate = true, onStatus = () => {} }) {
  // Steps mode: synthesize narration BEFORE recording so segment pacing and
  // caption lifetimes match the spoken clip durations exactly.
  let prepared = null;
  if (steps && narrate) {
    const texts = steps.filter(s => s.narration).map(s => s.narration);
    if (texts.length) {
      try {
        prepared = await prepareNarration(texts, path.join(workDir, 'tts'), voice, onStatus, speed);
        let i = 0;
        for (const s of steps) if (s.narration) s._narrDurMs = prepared.clips[i++].durMs;
      } catch (e) {
        onStatus(`narration pre-synth failed: ${e.message.slice(0, 80)}`);
      }
    }
  }

  const meta = await session.record({ url, mode: steps ? 'steps' : mode, steps, workDir, onStatus });

  const raw = path.join(workDir, 'raw.mp4');
  const narrated = path.join(workDir, 'narrated.mp4');
  const out = path.join(workDir, 'demo.mp4');
  await render(meta, raw, { onStatus });

  let narration = { narrated: false };
  if (narrate) narration = await addNarration(meta, raw, narrated, { voice, speed, prepared, onStatus });
  else fs.copyFileSync(raw, narrated);

  const recipe = buildRecipe({ url, mode, steps, meta });
  fs.writeFileSync(path.join(workDir, 'recipe.json'), JSON.stringify(recipe, null, 2));
  onStatus('embedding recipe');
  await embedRecipe(narrated, out, recipe);

  fs.rmSync(meta.framesDir, { recursive: true, force: true });
  fs.rmSync(raw, { force: true });
  fs.rmSync(narrated, { force: true });
  return { video: out, recipe: path.join(workDir, 'recipe.json'), meta, narration };
}

async function outline(session, url) {
  const page = await session.open(url);
  return extractOutline(page);
}

module.exports = { produceDemo, outline };
