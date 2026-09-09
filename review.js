// Review: turn a finished demo back into something an agent can look at.
// Extracts evenly spaced frames, the embedded recipe, and segment timings —
// the agent inspects the frames, patches the steps YAML, and re-records.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// ffmpeg -i with no output exits non-zero by design; capture both streams and
// let callers pattern-match (duration lives on stderr, ffmetadata on stdout).
const ff = args => new Promise(res => {
  execFile(ffmpegPath, args, { maxBuffer: 1e7 }, (_err, stdout, stderr) =>
    res({ stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

async function videoInfo(videoPath) {
  const info = await ff(['-i', videoPath]);
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(info.stderr);
  const durMs = m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] * 10 : 0;
  const meta = await ff(['-i', videoPath, '-f', 'ffmetadata', '-']);
  const r = /voila-recipe:(\{.*)/.exec(meta.stdout);
  let recipe = null;
  if (r) { try { recipe = JSON.parse(r[1].split('\n')[0].replace(/\\(.)/g, '$1')); } catch { /* unparseable */ } }
  return { durMs, recipe };
}

async function reviewDemo(videoPath, { count = 12, outDir = null } = {}) {
  if (!fs.existsSync(videoPath)) throw new Error(`video not found: ${videoPath}`);
  const { durMs, recipe } = await videoInfo(videoPath);
  if (!durMs) throw new Error('could not read video duration');

  outDir = outDir || path.join(path.dirname(videoPath), 'review');
  fs.mkdirSync(outDir, { recursive: true });

  const frames = [];
  for (let i = 0; i < count; i++) {
    const atSec = +(((i + 0.5) * durMs) / count / 1000).toFixed(1);
    const file = path.join(outDir, `frame-${String(atSec).padStart(5, '0')}s.png`);
    await new Promise((res, rej) => {
      execFile(ffmpegPath, ['-y', '-ss', String(atSec), '-i', videoPath, '-vframes', '1', file],
        err => (err ? rej(err) : res()));
    });
    frames.push({ atSec, file });
  }

  // Segment timings from the sibling meta.json when available (richer than the recipe).
  let segments = recipe ? recipe.segments || null : null;
  const metaPath = path.join(path.dirname(videoPath), 'meta.json');
  let warnings = [];
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      warnings = meta.warnings || [];
      segments = (meta.segments || []).map(s => ({
        at: +((s.t - meta.tStart) / 1000).toFixed(2),
        caption: s.caption, narration: s.narration,
        durSec: s.dur ? +(s.dur / 1000).toFixed(2) : null,
      }));
    } catch { /* keep recipe segments */ }
  }

  return { video: videoPath, durationSec: +(durMs / 1000).toFixed(1), frames, segments, recipe, warnings };
}

module.exports = { reviewDemo };
