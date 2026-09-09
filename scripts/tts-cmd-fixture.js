// CI fixture: a stand-in "external TTS engine". Writes a short tone to {out}
// so the --tts-cmd plumbing can be exercised on every platform, including
// ones with no system voices installed.
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const out = process.argv[2];
const text = process.argv.slice(3).join(' ');
const seconds = Math.max(1, Math.min(8, text.split(/\s+/).length / 3)).toFixed(2);
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `sine=frequency=340:duration=${seconds}`, '-ac', '1', out], { stdio: 'pipe' });
console.log(`fixture wrote ${seconds}s to ${out}`);
