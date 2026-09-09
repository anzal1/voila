// Voila server: one-click UI + API.
// POST /api/open   {url}         -> opens the recording browser so the user can sign in
// POST /api/record {url, mode}   -> runs tour + render, job tracked in /api/status
// GET  /api/status               -> {state, detail, video?}

const path = require('path');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const { VoilaSession } = require('./recorder');
const { produceDemo } = require('./pipeline');

const PORT = process.env.PORT || 4477;
const HEADLESS = process.env.VOILA_HEADLESS === '1';
const RECORDINGS = path.join(__dirname, 'recordings');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(RECORDINGS));

let session = new VoilaSession({ headless: HEADLESS });
let job = { state: 'idle', detail: '', video: null };

async function sessionFor(device = 'desktop') {
  if (session.device !== device) {
    await session.close();
    session = new VoilaSession({ headless: HEADLESS, device });
  }
  return session;
}

app.post('/api/open', async (req, res) => {
  try {
    const { url, device } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    await (await sessionFor(device || 'desktop')).open(url);
    res.json({ ok: true, message: 'Browser open — sign in there if the site needs it, then hit Record.' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/record', async (req, res) => {
  if (job.state === 'working') return res.status(409).json({ error: 'a recording is already in progress' });
  const { url, mode = 'auto', stepsYaml = null } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const id = `demo-${Date.now()}`;
  const workDir = path.join(RECORDINGS, id);
  job = { state: 'working', detail: 'starting', video: null };
  res.json({ ok: true, id });

  (async () => {
    try {
      const steps = stepsYaml ? yaml.load(stepsYaml) : null;
      await produceDemo(await sessionFor(req.body.device || 'desktop'), {
        url, mode, steps, workDir,
        narrate: req.body.narrate !== false,
        voice: req.body.voice || null,
        onStatus: d => { job.detail = d; },
      });
      job = { state: 'done', detail: 'ready', video: `/videos/${id}/demo.mp4` };
    } catch (e) {
      job = { state: 'error', detail: String(e.message || e), video: null };
    }
  })();
});

app.get('/api/status', (_req, res) => res.json(job));

app.listen(PORT, () => {
  console.log(`voila running at http://localhost:${PORT} (headless=${HEADLESS})`);
});
