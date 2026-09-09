// Renderer: turns captured frames + cursor/zoom timeline into a smooth MP4.
// For each output frame we compute the eased zoom level and a camera center
// following the cursor, crop the 2x-DPR source frame, and pipe JPEGs to ffmpeg.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const cubicInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

// Piecewise value from timeline events [{t, from, to, dur}] at time t.
function scalarAt(events, t, initial) {
  let v = initial;
  for (const e of events) {
    if (t < e.t) break;
    v = e.from + (e.to - e.from) * cubicInOut(Math.min(1, (t - e.t) / e.dur));
  }
  return v;
}

// Camera center: an explicit zoom target when one is set, otherwise the cursor.
function centerAt(zooms, t, cursor) {
  let active = null;
  for (const e of zooms) {
    if (t < e.t) break;
    if (!e.toCenter) { active = null; continue; }
    const p = cubicInOut(Math.min(1, (t - e.t) / e.dur));
    const from = e.fromCenter || cursor;
    active = {
      x: from.x + (e.toCenter.x - from.x) * p,
      y: from.y + (e.toCenter.y - from.y) * p,
    };
  }
  return active || cursor;
}

function pointAt(events, t, initial) {
  let v = { ...initial };
  for (const e of events) {
    if (t < e.t) break;
    const p = cubicInOut(Math.min(1, (t - e.t) / e.dur));
    v = { x: e.from.x + (e.to.x - e.from.x) * p, y: e.from.y + (e.to.y - e.from.y) * p };
  }
  return v;
}

const CAPTION_MAX_MS = 7000;

function captionAt(segments, t) {
  let active = null;
  for (const s of segments || []) {
    if (s.t > t) break;
    active = s;
  }
  if (!active || !active.caption) return null;
  // Caption lifetime follows the narration clip when its duration is known.
  const windowMs = active.dur ? active.dur + 500 : CAPTION_MAX_MS;
  return t - active.t < windowMs ? active.caption : null;
}

const escapeXml = s => s.replace(/[<>&'"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function wrapText(text, maxChars = 46) {
  const words = text.split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + w).length > maxChars) lines.push(w);
    else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
  }
  return lines.slice(0, 2);
}

async function captionOverlay(text, outW) {
  const fontSize = Math.max(19, Math.min(34, Math.round(outW * 0.0177)));
  const maxChars = Math.min(46, Math.floor((outW * 0.85) / (fontSize * 0.56)));
  const lines = wrapText(text, maxChars);
  const lineH = Math.round(fontSize * 1.35), padX = Math.round(fontSize * 0.88), padY = Math.round(fontSize * 0.59);
  const boxW = Math.min(outW - 80, Math.max(...lines.map(l => l.length)) * fontSize * 0.56 + padX * 2);
  const boxH = lines.length * lineH + padY * 2 - 8;
  const svg = `<svg width="${Math.round(boxW)}" height="${boxH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${Math.round(boxW)}" height="${boxH}" rx="14" fill="rgba(10,10,14,0.74)"/>
    ${lines.map((l, i) =>
      `<text x="50%" y="${padY + (i + 0.78) * lineH - Math.round(fontSize * 0.29)}" text-anchor="middle" fill="#ffffff"
        font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600">${escapeXml(l)}</text>`
    ).join('')}
  </svg>`;
  return {
    input: await sharp(Buffer.from(svg)).png().toBuffer(),
    width: Math.round(boxW),
    height: boxH,
  };
}

async function render(meta, outFile, { fps = 30, outW = null, outH = null, onStatus = () => {} } = {}) {
  const { frames, moves, zooms, tStart, tEnd, viewport, framesDir } = meta;
  if (!frames.length) throw new Error('no frames captured');

  // Output follows the recorded viewport's aspect (portrait for mobile).
  // 1.5x the CSS viewport, rounded to even for yuv420p (desktop → 1920x1200).
  const even = n => Math.round(n / 2) * 2;
  if (!outW) outW = even(viewport.width * 1.5);
  if (!outH) outH = even(viewport.height * 1.5);

  // Actual encoded frame size (screencast can letterbox/scale).
  const first = await sharp(path.join(framesDir, frames[0].file)).metadata();
  const W = first.width, H = first.height;
  const sx = W / viewport.width, sy = H / viewport.height;

  const ffmpeg = spawn(ffmpegPath, [
    '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'veryfast',
    '-movflags', '+faststart', outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ffmpeg.stderr.on('data', d => { ffErr += d; if (ffErr.length > 20000) ffErr = ffErr.slice(-10000); });
  const done = new Promise((res, rej) => {
    ffmpeg.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}\n${ffErr.slice(-2000)}`))));
    ffmpeg.on('error', rej);
  });

  const writeFrame = buf => new Promise((res, rej) => {
    ffmpeg.stdin.write(buf, err => (err ? rej(err) : res()));
  });

  const total = Math.max(1, Math.floor(((tEnd - tStart) / 1000) * fps));
  let frameIdx = 0;
  let lastKey = null, lastBuf = null;
  let srcCache = { file: null, img: null };
  const overlayCache = new Map();

  for (let i = 0; i < total; i++) {
    const t = tStart + (i * 1000) / fps;

    while (frameIdx + 1 < frames.length && frames[frameIdx + 1].t <= t) frameIdx++;
    const srcFile = frames[frameIdx].file;

    const z = Math.max(1, Math.min(3, scalarAt(zooms, t, 1)));
    const cur = pointAt(moves, t, { x: viewport.width / 2, y: viewport.height / 2 });
    const cam = centerAt(zooms, t, cur);
    const caption = captionAt(meta.segments, t);

    const cropW = W / z, cropH = H / z;
    let cx = cam.x * sx, cy = cam.y * sy;
    cx = Math.max(cropW / 2, Math.min(W - cropW / 2, cx));
    cy = Math.max(cropH / 2, Math.min(H - cropH / 2, cy));

    const left = Math.max(0, Math.min(W - Math.round(cropW), Math.round(cx - cropW / 2)));
    const top = Math.max(0, Math.min(H - Math.round(cropH), Math.round(cy - cropH / 2)));

    const key = `${srcFile}|${left}|${top}|${Math.round(cropW)}|${caption || ''}`;
    if (key === lastKey && lastBuf) {
      await writeFrame(lastBuf);
      continue;
    }

    if (srcCache.file !== srcFile) {
      srcCache = { file: srcFile, img: await fs.promises.readFile(path.join(framesDir, srcFile)) };
    }

    let img = sharp(srcCache.img)
      .extract({ left, top, width: Math.round(cropW), height: Math.round(cropH) })
      .resize(outW, outH, { fit: 'fill' });

    if (caption) {
      if (!overlayCache.has(caption)) overlayCache.set(caption, await captionOverlay(caption, outW));
      const ov = overlayCache.get(caption);
      img = sharp(await img.toBuffer()).composite([{
        input: ov.input,
        left: Math.round((outW - ov.width) / 2),
        top: outH - ov.height - 46,
      }]);
    }

    const buf = await img.jpeg({ quality: 93 }).toBuffer();

    lastKey = key;
    lastBuf = buf;
    await writeFrame(buf);

    if (i % (fps * 2) === 0) onStatus(`rendering ${Math.round((i / total) * 100)}%`);
  }

  ffmpeg.stdin.end();
  await done;
  onStatus('render complete');
  return outFile;
}

module.exports = { render };
