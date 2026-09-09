// Narration: on-device TTS mixed under the rendered video at segment offsets.
// Default backend is Kokoro-82M (open source, Apache-2.0, ~80MB quantized,
// runs on CPU via ONNX — near-human quality, no cloud, no API keys).
// Falls back to macOS `say` if Kokoro fails; passes through if no TTS exists.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const voices = require('./voices');

const run = (cmd, args) => new Promise((res, rej) => {
  execFile(cmd, args, { maxBuffer: 1e7 }, (err, stdout, stderr) =>
    err ? rej(new Error(`${cmd} failed: ${stderr || err.message}`)) : res(stdout));
});

// --- Kokoro backend ----------------------------------------------------------

let kokoroInstance = null;
async function getKokoro() {
  if (!kokoroInstance) {
    // Must load the CJS build (exports map: require → dist/kokoro.cjs): it
    // resolves bundled voice files via __dirname, while the ESM build loses
    // __dirname and breaks when cwd isn't the package root.
    const { KokoroTTS } = require('kokoro-js');
    kokoroInstance = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' }
    );
  }
  return kokoroInstance;
}

async function synthKokoro(texts, dir, voice, onStatus, speed = 1) {
  // Fail loudly on a bad voice name rather than silently using the default.
  if (voice && /^[a-z]{2}_/.test(voice) && !voices.isValid(voice)) {
    throw new Error(`unknown voice "${voice}". Try: ${voices.suggest(voice).join(', ')} (run \`voila voices\` for all ${voices.ranked().length})`);
  }
  onStatus('loading Kokoro TTS');
  const tts = await getKokoro();
  const v = voice && voices.isValid(voice) ? voice : 'af_heart';
  onStatus(`narrating with Kokoro (${v}${speed !== 1 ? ` @${speed}x` : ''})`);
  const clips = [];
  for (let i = 0; i < texts.length; i++) {
    const file = path.join(dir, `seg${i}.wav`);
    const audio = await tts.generate(texts[i], { voice: v, speed });
    await audio.save(file);
    const durMs = audio.audio && audio.sampling_rate
      ? Math.round((audio.audio.length / audio.sampling_rate) * 1000)
      : await ffDurationMs(file);
    clips.push({ file, durMs });
  }
  return { clips, voice: v, backend: 'kokoro' };
}

// Parse a media file's duration from ffmpeg's info output (no ffprobe in ffmpeg-static).
function ffDurationMs(file) {
  return new Promise(resolve => {
    execFile(ffmpegPath, ['-i', file], (_err, _stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr || '');
      resolve(m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4] * 10) : 4000);
    });
  });
}

// --- macOS `say` fallback ----------------------------------------------------

async function pickSayVoice(preferred) {
  if (preferred && !/^[a-z]{2}_/.test(preferred)) return preferred;
  try {
    const list = await run('say', ['-v', '?']);
    for (const want of [/\(Premium\)/, /\(Enhanced\)/, /^Samantha /m]) {
      const m = list.split('\n').find(l => want.test(l));
      if (m) return m.split(/\s{2,}/)[0].trim();
    }
  } catch { /* fall through */ }
  return 'Samantha';
}

async function synthSay(texts, dir, voice, onStatus) {
  const v = await pickSayVoice(voice);
  onStatus(`narrating with say (${v})`);
  const clips = [];
  for (let i = 0; i < texts.length; i++) {
    const file = path.join(dir, `seg${i}.aiff`);
    await run('say', ['-v', v, '-r', '185', '-o', file, texts[i]]);
    clips.push({ file, durMs: await ffDurationMs(file) });
  }
  return { clips, voice: v, backend: 'say' };
}

// --- pipeline entry ----------------------------------------------------------

// Synthesize narration clips up front so the recorder can pace segments to the
// spoken durations. Returns {clips: [{file, durMs}], voice, backend}.
async function prepareNarration(texts, dir, voice, onStatus = () => {}, speed = 1) {
  fs.mkdirSync(dir, { recursive: true });
  const backend = process.env.VOILA_TTS || 'kokoro';
  if (backend === 'kokoro') {
    try {
      return await synthKokoro(texts, dir, voice, onStatus, speed);
    } catch (e) {
      if (/unknown voice/.test(e.message)) throw e;   // user error, not a fallback case
      onStatus(`kokoro unavailable (${e.message.slice(0, 80)})`);
    }
  }
  if (process.platform === 'darwin') return synthSay(texts, dir, voice, onStatus);
  throw new Error('no TTS backend available');
}

async function addNarration(meta, videoIn, videoOut, { voice = null, speed = 1, prepared = null, onStatus = () => {} } = {}) {
  const segs = (meta.segments || []).filter(s => s.narration);
  if (!segs.length) {
    fs.copyFileSync(videoIn, videoOut);
    return { narrated: false };
  }

  const dir = path.join(path.dirname(videoOut), 'tts');

  let synth = prepared && prepared.clips.length === segs.length ? prepared : null;
  if (!synth) {
    try {
      synth = await prepareNarration(segs.map(s => s.narration), dir, voice, onStatus, speed);
    } catch (e) {
      onStatus(`narration skipped: ${e.message}`);
      fs.copyFileSync(videoIn, videoOut);
      return { narrated: false };
    }
  }

  const clips = synth.clips.map((c, i) => ({
    file: c.file,
    delayMs: Math.max(0, segs[i].t - meta.tStart + 150),
  }));

  const durSec = ((meta.tEnd - meta.tStart) / 1000).toFixed(3);
  const inputs = clips.flatMap(c => ['-i', c.file]);
  const delayed = clips.map((c, i) => `[${i + 1}:a]adelay=${c.delayMs}|${c.delayMs}[a${i}]`).join(';');
  const mixIn = clips.map((_, i) => `[a${i}]`).join('');
  const filter = `${delayed};${mixIn}amix=inputs=${clips.length}:normalize=0,apad[aout]`;

  onStatus('mixing narration');
  await new Promise((res, rej) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-i', videoIn, ...inputs,
      '-filter_complex', filter,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      '-t', durSec, videoOut,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg mix exited ${code}\n${err.slice(-1500)}`))));
    ff.on('error', rej);
  });

  fs.rmSync(dir, { recursive: true, force: true });
  return { narrated: true, voice: synth.voice, backend: synth.backend, segments: clips.length };
}

module.exports = { addNarration, prepareNarration };
