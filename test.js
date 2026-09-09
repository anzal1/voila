// Headless end-to-end smoke test: record an auto tour of a public site, render MP4.
const path = require('path');
const fs = require('fs');
const { VoilaSession } = require('./recorder');
const { render } = require('./render');

(async () => {
  const url = process.argv[2] || 'https://playwright.dev';
  const workDir = path.join(__dirname, 'recordings', 'test-run');
  fs.rmSync(workDir, { recursive: true, force: true });

  const session = new VoilaSession({
    headless: true,
    profileDir: path.join(__dirname, 'profile-test'),
  });

  const t0 = Date.now();
  const meta = await session.record({ url, workDir, onStatus: s => console.log('[status]', s) });
  console.log(`captured ${meta.frames.length} frames over ${((meta.tEnd - meta.tStart) / 1000).toFixed(1)}s`);
  console.log(`moves: ${meta.moves.length}, zooms: ${meta.zooms.length}`);

  const out = path.join(workDir, 'demo.mp4');
  await render(meta, out, { onStatus: s => console.log('[render]', s) });
  await session.close();

  const size = fs.statSync(out).size;
  console.log(`OK: ${out} (${(size / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
