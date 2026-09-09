// VoilaSession: owns a persistent Chromium profile (login survives restarts),
// records the viewport via CDP screencast (no OS screen-recording permission),
// and logs a cursor/zoom timeline the renderer replays for the zoom effect.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { OVERLAY_SOURCE } = require('./overlay');
const { autoTour, runSteps } = require('./tour');

// Device presets: what viewport the demo is recorded at. Mobile emulates an
// iPhone-class device (touch, mobile UA) so responsive sites render for real.
// maxZoom keeps the zoom camera sane per screen size: a 1.5x zoom that looks
// great on desktop crops words off a 390px phone viewport.
const DEVICES = {
  desktop: {
    viewport: { width: 1280, height: 800 }, dpr: 2, isMobile: false, hasTouch: false, maxZoom: 3,
  },
  mobile: {
    // maxZoom 1: mobile layouts are edge-to-edge, any horizontal crop cuts
    // text — scrolling carries the motion instead.
    viewport: { width: 390, height: 844 }, dpr: 3, isMobile: true, hasTouch: true, maxZoom: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
  tablet: {
    viewport: { width: 834, height: 1112 }, dpr: 2, isMobile: true, hasTouch: true, maxZoom: 1,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Timeline {
  constructor() {
    this.moves = [];
    this.zooms = [];
    this.segments = [];
    this.warnings = [];
    this.pos = { x: -60, y: -60 };
    this.zoom = 1;
  }
  recordSegment(caption, narration, dur = null) {
    this.segments.push({ t: Date.now(), caption: caption || null, narration: narration || null, dur });
  }
  recordMove(to, dur) {
    this.moves.push({ t: Date.now(), from: { ...this.pos }, to: { ...to }, dur });
    this.pos = { ...to };
  }
  recordZoom(level, dur) {
    this.zooms.push({ t: Date.now(), from: this.zoom, to: level, dur });
    this.zoom = level;
  }
}

class VoilaSession {
  constructor({ profileDir, headless = false, device = 'desktop' } = {}) {
    this.profileDir = profileDir || path.join(__dirname, 'profile');
    this.headless = headless;
    this.device = DEVICES[device] ? device : 'desktop';
    this.preset = DEVICES[this.device];
    this.context = null;
    this.page = null;
  }

  async open(url) {
    if (!this.context) {
      const launch = () => chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        viewport: this.preset.viewport,
        deviceScaleFactor: this.preset.dpr,
        isMobile: this.preset.isMobile,
        hasTouch: this.preset.hasTouch,
        ...(this.preset.userAgent ? { userAgent: this.preset.userAgent } : {}),
        args: ['--hide-scrollbars'],
      });
      try {
        this.context = await launch();
      } catch (e) {
        // Zero-install path: fetch Chromium on first use instead of making the
        // user run `npx playwright install` themselves.
        if (!/Executable doesn't exist|missing dependencies|browser.*not found/i.test(String(e.message))) throw e;
        const { execFileSync } = require('child_process');
        let cliPath;
        try { cliPath = require.resolve('playwright/cli'); }
        catch { cliPath = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'); }
        execFileSync(process.execPath, [cliPath, 'install', 'chromium'], { stdio: 'pipe', timeout: 600000 });
        this.context = await launch();
      }
      await this.context.addInitScript(OVERLAY_SOURCE);
      this.context.on('close', () => { this.context = null; this.page = null; });
    }
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.on('close', () => { this.page = null; });
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    return this.page;
  }

  // Records a demo of `url` into workDir. Returns metadata for the renderer.
  async record({ url, mode = 'auto', steps = null, workDir, onStatus = () => {} }) {
    const framesDir = path.join(workDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    onStatus('opening page');
    const page = (this.page && !this.page.isClosed() && this.page.url().startsWith(new URL(url).origin))
      ? this.page
      : await this.open(url);
    this.page = page;
    await page.evaluate(OVERLAY_SOURCE);

    const client = await this.context.newCDPSession(page);
    const frames = [];
    const writes = [];
    let idx = 0;

    client.on('Page.screencastFrame', ev => {
      const file = `f${String(idx++).padStart(5, '0')}.jpg`;
      const t = ev.metadata && ev.metadata.timestamp ? ev.metadata.timestamp * 1000 : Date.now();
      writes.push(fs.promises.writeFile(path.join(framesDir, file), Buffer.from(ev.data, 'base64')));
      frames.push({ t, file });
      client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    });

    await client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 88,
      maxWidth: this.preset.viewport.width * this.preset.dpr,
      maxHeight: this.preset.viewport.height * this.preset.dpr,
      everyNthFrame: 1,
    });

    const tl = new Timeline();
    const tStart = Date.now();

    onStatus('recording tour');
    const tourOpts = { sleep, maxZoom: this.preset.maxZoom || 3 };
    try {
      if (mode === 'steps' && steps) {
        await runSteps(page, tl, steps, tourOpts);
      } else {
        await autoTour(page, tl, tourOpts);
      }
    } finally {
      await sleep(500); // trailing frames
      await client.send('Page.stopScreencast').catch(() => {});
      await Promise.allSettled(writes);
      await client.detach().catch(() => {});
    }

    const tEnd = Date.now();
    const meta = {
      tStart, tEnd,
      viewport: this.preset.viewport, dpr: this.preset.dpr, device: this.device,
      frames: frames.sort((a, b) => a.t - b.t),
      moves: tl.moves, zooms: tl.zooms, segments: tl.segments,
      warnings: tl.warnings || [],
      framesDir,
    };
    fs.writeFileSync(path.join(workDir, 'meta.json'), JSON.stringify(meta));
    onStatus('tour captured');
    return meta;
  }

  async close() {
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.page = null;
  }
}

module.exports = { VoilaSession, DEVICES };
