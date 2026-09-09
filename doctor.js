// Pre-flight: tell people what voila needs, what is already on disk, and
// download the rest with visible progress. The first run used to be several
// silent minutes, which reads as a hang.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const MB = n => `${(n / 1e6).toFixed(0)}MB`;

function chromiumPath() {
  try {
    const { chromium } = require('playwright');
    return chromium.executablePath();
  } catch { return null; }
}

function chromiumReady() {
  const p = chromiumPath();
  return !!(p && fs.existsSync(p));
}

// transformers.js caches models under ~/.cache/huggingface by default.
function kokoroCacheDir() {
  return require('./modelcache').CACHE_DIR;
}

function kokoroReady() {
  const dir = kokoroCacheDir();
  if (!fs.existsSync(dir)) return false;
  const hit = [];
  const walk = (d, depth = 0) => {
    if (depth > 4 || hit.length) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (hit.length) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.onnx(_data)?$/.test(e.name) && fs.statSync(full).size > 5e6) hit.push(full);
    }
  };
  try { walk(dir); } catch { /* unreadable cache */ }
  return hit.length > 0;
}

function ffmpegReady() {
  try { return fs.existsSync(require('ffmpeg-static')); } catch { return false; }
}

// Install Chromium with its progress bar visible instead of swallowed.
function installChromium({ quiet = false } = {}) {
  let cliPath;
  try { cliPath = require.resolve('playwright/cli'); }
  catch { cliPath = path.join(path.dirname(require.resolve('playwright')), 'cli.js'); }
  execFileSync(process.execPath, [cliPath, 'install', 'chromium'], {
    stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'],
    timeout: 900000,
  });
}

async function warmKokoro(onStatus = () => {}) {
  require('./modelcache').useStableCache();
  const { KokoroTTS } = require('kokoro-js');
  let lastPct = -5;
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    progress_callback: p => {
      if (p.status === 'download') return onStatus(`fetching ${p.file}`);
      if (p.status !== 'progress') return;
      // Hugging Face omits content-length on some files, so fall back to bytes.
      if (typeof p.total === 'number' && p.total > 0) {
        const pct = Math.floor((p.progress || 0) / 5) * 5;
        if (pct > lastPct) { lastPct = pct; onStatus(`${p.file || 'model'} ${pct}% of ${MB(p.total)}`); }
      } else if (typeof p.loaded === 'number') {
        const step = Math.floor(p.loaded / 1e7);
        if (step > lastPct) { lastPct = step; onStatus(`${p.file || 'model'} ${MB(p.loaded)} downloaded`); }
      }
    },
  });
  // Force one tiny synthesis so the voice files are fetched too.
  await tts.generate('Ready.', { voice: 'af_heart' });
  return true;
}

async function doctor({ fix = true, log = console.error } = {}) {
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;
  log(`node        ${process.versions.node} ${nodeOk ? 'ok' : 'TOO OLD, voila needs >= 20'}`);
  log(`ffmpeg      ${ffmpegReady() ? 'bundled, ok' : 'MISSING (reinstall voila-recorder)'}`);

  let chrome = chromiumReady();
  log(`chromium    ${chrome ? 'installed' : 'not installed (~150MB download)'}`);
  if (!chrome && fix) {
    log('\ndownloading chromium...');
    installChromium();
    chrome = chromiumReady();
    log(`chromium    ${chrome ? 'installed' : 'FAILED'}`);
  }

  let voice = kokoroReady();
  log(`voice model ${voice ? `cached in ${kokoroCacheDir()}` : 'not cached (~90MB download, first narration only)'}`);
  if (!voice && fix) {
    log('\nfetching the voice model...');
    try {
      await warmKokoro(m => log(`  ${m}`));
      voice = true;
      log('voice model cached');
    } catch (e) {
      log(`voice model FAILED: ${e.message.slice(0, 120)}`);
      log('(recording still works with --no-narrate)');
    }
  }

  const ready = nodeOk && ffmpegReady() && chrome;
  log(`\n${ready ? 'voila is ready. Try: voila record https://example.com' : 'voila is not ready yet, see above.'}`);
  return { nodeOk, ffmpeg: ffmpegReady(), chromium: chrome, voice, ready };
}

module.exports = { doctor, chromiumReady, kokoroReady, installChromium, warmKokoro };
