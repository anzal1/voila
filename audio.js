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
    require('./modelcache').useStableCache();
    const { KokoroTTS } = require('kokoro-js');
    kokoroInstance = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' }
    );
  }
  return kokoroInstance;
}

async function _unusedSynthKokoro(texts, dir, voice, onStatus, speed = 1) {
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

async function _unusedSynthSay(texts, dir, voice, onStatus) {
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
// Each narration item is {text, voice?, audio?}. Voice decides the engine:
//   af_heart          -> Kokoro (English, best quality, cross platform)
//   say:Monica        -> a system voice (macOS; ~50 languages)
//   (--tts-cmd set)   -> any external engine, any language
// A step can also point at a ready-made file with `audio:`, which bypasses TTS.
// Because the voice is per item, one demo can mix languages.

function engineFor(voice, ttsCmd) {
  // Supplying --tts-cmd means "use my engine", unless a step names a specific
  // Kokoro or system voice, which then wins for that step.
  if (!voice) {
    if (ttsCmd) return 'cmd';
    return process.env.VOILA_TTS === 'say' ? 'say' : 'kokoro';
  }
  if (String(voice).startsWith('cmd:') || (ttsCmd && String(voice).startsWith('cmd'))) return 'cmd';
  if (String(voice).startsWith('say:')) return 'say';
  if (voices.isValid(voice)) return 'kokoro';
  if (voices.isSystemVoice(voice)) return 'say';
  if (ttsCmd) return 'cmd';
  throw new Error(
    `unknown voice "${voice}". Kokoro (English): ${voices.suggest(voice).join(', ')}. ` +
    `For other languages use a system voice like "say:Monica" (see \`voila voices --all\`) ` +
    `or supply --tts-cmd for your own engine.`
  );
}

async function sayOne(text, file, voiceName, speed) {
  const rate = Math.round(185 * (speed || 1));
  await run('say', ['-v', voiceName, '-r', String(rate), '-o', file, text]);
}

async function cmdOne(text, file, voiceName, ttsCmd) {
  const cmd = ttsCmd
    .replaceAll('{text}', text.replace(/"/g, '\\"'))
    .replaceAll('{out}', file)
    .replaceAll('{voice}', voiceName || '');
  await new Promise((res, rej) => {
    require('child_process').exec(cmd, { maxBuffer: 1e7 }, (err, _o, se) =>
      err ? rej(new Error(`tts-cmd failed: ${String(se || err.message).slice(0, 200)}`)) : res());
  });
  if (!fs.existsSync(file)) throw new Error(`tts-cmd produced no file at ${file}`);
}

// Synthesize every narration clip up front so the recorder can pace segments
// to real spoken durations. Returns {clips:[{file,durMs}], voice, backend}.
async function prepareNarration(items, dir, defaultVoice, onStatus = () => {}, speed = 1, ttsCmd = null) {
  fs.mkdirSync(dir, { recursive: true });
  const norm = items.map(it => (typeof it === 'string' ? { text: it } : it));
  const clips = [];
  const used = new Set();
  let kokoro = null;

  for (let i = 0; i < norm.length; i++) {
    const it = norm[i];
    const voice = it.voice || defaultVoice || null;

    // A pre-made audio file wins over any engine.
    if (it.audio) {
      if (!fs.existsSync(it.audio)) throw new Error(`audio file not found: ${it.audio}`);
      clips.push({ file: it.audio, durMs: await ffDurationMs(it.audio) });
      used.add('file');
      continue;
    }

    const engine = engineFor(voice, ttsCmd);
    const ext = engine === 'kokoro' ? 'wav' : engine === 'say' ? 'aiff' : 'wav';
    const file = path.join(dir, `seg${i}.${ext}`);

    if (engine === 'kokoro') {
      if (!kokoro) {
        onStatus('loading Kokoro TTS');
        require('./modelcache').useStableCache();
        const { KokoroTTS } = require('kokoro-js');
        kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' });
      }
      const v = voice && voices.isValid(voice) ? voice : 'af_heart';
      const { langOf, phonemize } = require('./phonemes');
      const lang = langOf(v);
      onStatus(`narrating ${i + 1}/${norm.length} with Kokoro (${v}, ${lang ? lang.name : 'English'})`);

      let audio;
      if (lang && lang.tier !== 'native') {
        // kokoro-js only phonemizes English, so do it ourselves with espeak-ng
        // (WASM, every platform) and feed the model token ids directly.
        if (lang.tier === 'experimental' && !process.env.VOILA_EXPERIMENTAL_LANGS) {
          throw new Error(
            `${lang.name} voices are experimental: espeak mispronounces them badly ` +
            `(Japanese leaks English words, Mandarin emits numeric tones Kokoro never saw). ` +
            `Set VOILA_EXPERIMENTAL_LANGS=1 to try anyway, or use --tts-cmd with a ${lang.name} engine.`
          );
        }
        const ipa = await phonemize(it.text, v);
        const enc = kokoro.tokenizer(ipa, { truncation: true });
        audio = await kokoro.generate_from_ids(enc.input_ids, { voice: v, speed });
      } else {
        audio = await kokoro.generate(it.text, { voice: v, speed });
      }
      await audio.save(file);
      clips.push({
        file,
        durMs: audio.audio && audio.sampling_rate
          ? Math.round((audio.audio.length / audio.sampling_rate) * 1000)
          : await ffDurationMs(file),
      });
      used.add(`kokoro:${v}`);
    } else if (engine === 'say') {
      if (process.platform !== 'darwin') {
        throw new Error(`system voices need macOS. Use a Kokoro voice for English, or --tts-cmd on this platform.`);
      }
      const name = String(voice).replace(/^say:/, '');
      onStatus(`narrating ${i + 1}/${norm.length} with system voice (${name})`);
      await sayOne(it.text, file, name, speed);
      clips.push({ file, durMs: await ffDurationMs(file) });
      used.add(`say:${name}`);
    } else {
      onStatus(`narrating ${i + 1}/${norm.length} with tts-cmd`);
      await cmdOne(it.text, file, String(voice || '').replace(/^cmd:/, ''), ttsCmd);
      clips.push({ file, durMs: await ffDurationMs(file) });
      used.add('cmd');
    }
  }

  return { clips, voice: [...used].join(', ') || 'none', backend: [...used].join(', ') };
}

async function addNarration(meta, videoIn, videoOut, { voice = null, speed = 1, ttsCmd = null, prepared = null, onStatus = () => {} } = {}) {
  const segs = (meta.segments || []).filter(s => s.narration);
  if (!segs.length) {
    fs.copyFileSync(videoIn, videoOut);
    return { narrated: false };
  }

  const dir = path.join(path.dirname(videoOut), 'tts');

  let synth = prepared && prepared.clips.length === segs.length ? prepared : null;
  if (!synth) {
    try {
      synth = await prepareNarration(
        segs.map(s => ({ text: s.narration, voice: s.voice, audio: s.audio })),
        dir, voice, onStatus, speed, ttsCmd);
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

  fs.rmSync(dir, { recursive: true, force: true });   // only generated clips live here
  return { narrated: true, voice: synth.voice, backend: synth.backend, segments: clips.length };
}

module.exports = { addNarration, prepareNarration };
