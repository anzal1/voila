// CI helper: assert the rendered demo actually carries a narration track.
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const file = process.argv[2];
let out = '';
try { execFileSync(ffmpeg, ['-i', file], { stdio: 'pipe' }); }
catch (e) { out = String(e.stderr || ''); }

if (!/Audio: aac/.test(out)) {
  console.error(out || '(no ffmpeg output)');
  throw new Error(`no narration track in ${file}`);
}
console.log(`narration track OK in ${file}`);
