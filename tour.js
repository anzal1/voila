// Tour engine: the choreography that runs inside the recorded browser.
// autoTour = zero-config guided pass over any page (hover, scroll, zoom cues).
// runSteps = deterministic YAML script for custom flows (clicks, typing, navigation).

const { OVERLAY_SOURCE } = require('./overlay');

async function ensureOverlay(page, tl) {
  await page.evaluate(OVERLAY_SOURCE);
  await page.evaluate(([x, y]) => window.__voila.jump(x, y), [tl.pos.x, tl.pos.y]);
}

async function moveCursor(page, tl, x, y, dur = 700) {
  await ensureOverlay(page, tl);
  tl.recordMove({ x, y }, dur);
  await page.evaluate(([x, y, d]) => window.__voila.moveTo(x, y, d), [x, y, dur]);
}

async function zoomTo(page, tl, level, dur = 800, { sleep, maxZoom = 3 }, center = null) {
  tl.recordZoom(Math.min(level, maxZoom), dur, center);
  await sleep(dur);
}

// Frame an element: pick the zoom level that fits its box with breathing room,
// and centre the camera on the element instead of wherever the cursor happens
// to be. Returns {level, center} clamped so the crop never leaves the viewport.
function frameElement(box, viewport, maxZoom, fill = 0.72) {
  const padX = viewport.width * 0.06, padY = viewport.height * 0.06;
  const level = Math.max(1, Math.min(
    maxZoom,
    Math.min(
      (viewport.width * fill) / Math.max(80, box.width + padX * 2),
      (viewport.height * fill) / Math.max(60, box.height + padY * 2)
    )
  ));
  const halfW = viewport.width / level / 2, halfH = viewport.height / level / 2;
  return {
    level,
    center: {
      x: Math.max(halfW, Math.min(viewport.width - halfW, box.x + box.width / 2)),
      y: Math.max(halfH, Math.min(viewport.height - halfH, box.y + box.height / 2)),
    },
  };
}

async function smoothScroll(page, tl, y, dur = 1100) {
  await ensureOverlay(page, tl);
  await page.evaluate(([y, d]) => window.__voila.scrollToY(y, d), [y, dur]);
}

async function clickWithRipple(page, tl, x, y) {
  await page.evaluate(() => { window.__voila.press(); window.__voila.ripple(); });
  await page.mouse.click(x, y);
}

// Move the cursor to the most salient element in view — keeps it alive after
// navigations and scrolls instead of parking in a corner.
async function driftToContent(page, tl, opts) {
  const { sleep } = opts;
  const focal = await page.evaluate(pickFocalInView).catch(() => null);
  if (focal) {
    await moveCursor(page, tl, focal.x + 14, focal.y + 10, 900);
    await sleep(150);
  }
}

// --- auto tour ---------------------------------------------------------------

const pickHero = () => {
  const el = document.querySelector('h1') || document.querySelector('main h2, header h2, h2');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 20 || r.top > innerHeight) return null;
  return { x: Math.min(r.x + r.width / 2, innerWidth - 40), y: Math.max(30, r.y + r.height / 2) };
};

const pickNavLinks = () => {
  const els = [...document.querySelectorAll('header a, nav a')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 12 && r.height > 8 && r.y >= 0 && r.y < 140;
  });
  return els.slice(0, 3).map(e => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
};

const pickFocalInView = () => {
  const cands = [...document.querySelectorAll('h2, h3, button, [role="button"], img, video, pre, table')];
  let best = null, bestScore = 0, bestEl = null;
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.bottom < innerHeight * 0.15 || r.top > innerHeight * 0.85) continue;
    if (r.width < 40 || r.height < 16) continue;
    const area = Math.min(r.width * r.height, innerWidth * innerHeight * 0.4);
    const score = area + (/^H[23]$/.test(el.tagName) ? 30000 : 0);
    if (score > bestScore) { bestScore = score; best = r; bestEl = el; }
  }
  if (!best) return null;
  const heading = /^H[23]$/.test(bestEl.tagName)
    ? bestEl
    : bestEl.closest('section, article, div')?.querySelector('h2, h3');
  const text = heading ? (heading.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70) : '';
  return {
    x: Math.max(30, Math.min(best.x + best.width / 2, innerWidth - 40)),
    y: Math.max(30, Math.min(best.y + best.height / 2, innerHeight - 40)),
    text,
  };
};

const pickPageInfo = () => {
  const h1 = (document.querySelector('h1')?.textContent || document.title || '')
    .trim().replace(/\s+/g, ' ').slice(0, 80);
  const desc = (document.querySelector('meta[name="description"]')?.content || '')
    .trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || '';
  return { h1, desc };
};

// Extracts a structural outline of the page — used by agent planners (MCP/CLI)
// to write a steps script without guessing selectors.
const pickOutline = () => {
  const clean = s => (s || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  return {
    title: document.title,
    h1: clean(document.querySelector('h1')?.textContent),
    description: document.querySelector('meta[name="description"]')?.content || '',
    nav: [...document.querySelectorAll('header a, nav a')].slice(0, 12)
      .map(a => ({ text: clean(a.textContent), href: a.getAttribute('href') }))
      .filter(l => l.text),
    headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 30)
      .map(h => ({ tag: h.tagName.toLowerCase(), text: clean(h.textContent) }))
      .filter(h => h.text),
    buttons: [...document.querySelectorAll('button, a[class*="btn"], [role="button"]')].slice(0, 15)
      .map(b => clean(b.textContent)).filter(Boolean),
  };
};

const pickCta = () => {
  const el = [...document.querySelectorAll('a, button')].find(e => {
    const r = e.getBoundingClientRect();
    return /get started|sign ?up|try|start|demo|download|docs/i.test(e.textContent || '')
      && r.y >= 0 && r.y < innerHeight && r.width > 30;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

async function autoTour(page, tl, opts) {
  const { sleep } = opts;
  await ensureOverlay(page, tl);
  await sleep(800);

  const info = await page.evaluate(pickPageInfo);
  const hero = await page.evaluate(pickHero);
  if (hero) {
    tl.recordSegment(info.h1, info.desc ? `${info.h1}. ${info.desc}` : `This is ${info.h1}.`);
    await moveCursor(page, tl, hero.x, hero.y, 950);
    await zoomTo(page, tl, 1.5, 900, opts);
    await sleep(900);
    await zoomTo(page, tl, 1.12, 750, opts);
  }

  const links = await page.evaluate(pickNavLinks);
  if (links.length) tl.recordSegment('A quick look around', "Here's a quick look at what's inside.");
  for (const l of links) {
    await moveCursor(page, tl, l.x, l.y, 650);
    await sleep(450);
  }

  const m = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight }));
  const maxStops = 4;
  let y = 0;
  for (let s = 0; s < maxStops && y < m.h - m.vh - 10; s++) {
    y = Math.min(y + m.vh * 0.9, m.h - m.vh);
    await smoothScroll(page, tl, y, 1100);
    await sleep(1250);
    const focal = await page.evaluate(pickFocalInView);
    if (focal) {
      if (focal.text) tl.recordSegment(focal.text, `${focal.text}.`);
      await moveCursor(page, tl, focal.x, focal.y, 700);
      await zoomTo(page, tl, 1.45, 700, opts);
      await sleep(900);
      await zoomTo(page, tl, 1.1, 600, opts);
    }
  }

  await smoothScroll(page, tl, 0, 950);
  await sleep(1050);

  const cta = await page.evaluate(pickCta);
  if (cta) {
    tl.recordSegment('Get started', "And when you're ready, getting started takes one click.");
    await moveCursor(page, tl, cta.x, cta.y, 800);
    await page.evaluate(() => window.__voila.ripple());
    await zoomTo(page, tl, 1.55, 700, opts);
    await sleep(1100);
  }
  await zoomTo(page, tl, 1, 800, opts);
  await sleep(700);
}

// --- steps mode --------------------------------------------------------------
// YAML: a list of {action, selector?, text?, url?, ms?, level?}
// actions: goto, click, hover, type, scroll_to, wait, zoom

// Resolve a selector into an on-screen box, giving the page a fair chance:
// wait for it to attach and become visible, try the visible-only variant, and
// scroll it into view. Only then give up.
async function targetBox(page, selector, { timeout = 6000 } = {}) {
  const tries = [selector, `${selector} >> visible=true`];
  for (const sel of tries) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: timeout / tries.length });
    } catch { continue; }
    let box = await loc.boundingBox().catch(() => null);
    if (!box || box.y < 0 || box.y > page.viewportSize().height) {
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      box = await loc.boundingBox().catch(() => null);
    }
    if (box && box.width > 0 && box.height > 0) {
      return { box, c: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
    }
  }
  throw new Error(`selector not found or not visible: ${selector}`);
}

async function runSteps(page, tl, steps, opts) {
  const { sleep } = opts;
  await ensureOverlay(page, tl);
  await sleep(600);

  // Narration-paced segments: a segment stays on screen at least as long as
  // its narration clip (durations pre-measured by the pipeline as _narrDurMs).
  let segStart = 0, segMinMs = 0;
  const finishSegment = async () => {
    const remaining = segStart + segMinMs - Date.now();
    if (remaining > 0) await sleep(remaining);
  };

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    if (step.caption || step.narration) {
      await finishSegment();
      tl.recordSegment(step.caption, step.narration, step._narrDurMs || null, step.voice || null, step.audio || null);
      segStart = Date.now();
      segMinMs = (step._narrDurMs || 0) + 600;
    }
    const runStep = async () => {
    switch (step.action) {
      case 'goto':
        await page.goto(step.url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await ensureOverlay(page, tl);
        await sleep(400);
        await driftToContent(page, tl, opts);
        break;
      case 'hover': {
        const { c } = await targetBox(page, step.selector);
        await moveCursor(page, tl, c.x, c.y, step.ms || 700);
        await page.mouse.move(c.x, c.y);
        break;
      }
      case 'click': {
        const { c, box } = await targetBox(page, step.selector);
        await moveCursor(page, tl, c.x, c.y, step.ms || 700);
        await page.evaluate(b => window.__voila.highlight(b.x, b.y, b.width, b.height), box);
        await sleep(300);
        await clickWithRipple(page, tl, c.x, c.y);
        await sleep(450);
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await ensureOverlay(page, tl);
        await driftToContent(page, tl, opts);
        break;
      }
      case 'type': {
        const { c, box } = await targetBox(page, step.selector);
        await moveCursor(page, tl, c.x, c.y, 600);
        await page.evaluate(b => window.__voila.highlight(b.x, b.y, b.width, b.height), box);
        await clickWithRipple(page, tl, c.x, c.y);
        await page.keyboard.type(step.text || '', { delay: step.delay || 55 });
        break;
      }
      case 'scroll': {
        await smoothScroll(page, tl, step.y || 0, step.ms || 1100);
        await driftToContent(page, tl, opts);
        break;
      }
      case 'scroll_to': {
        const box = await page.locator(step.selector).first().boundingBox();
        if (box) {
          const y = Math.max(0, box.y + (await page.evaluate(() => window.scrollY)) - 150);
          await smoothScroll(page, tl, y, step.ms || 1100);
          await driftToContent(page, tl, opts);
        }
        break;
      }
      case 'slide': {
        await ensureOverlay(page, tl);
        await page.evaluate(o => window.__voila.slide(o), {
          title: step.title || '',
          subtitle: step.subtitle || '',
          accent: step.accent || null,
          ms: step.ms || Math.max(3200, (step._narrDurMs || 0) + 800),
        });
        break;
      }
      case 'zoom': {
        if (step.selector) {
          const { box } = await targetBox(page, step.selector);
          const vp = page.viewportSize();
          const f = frameElement(box, vp, opts.maxZoom ?? 3, step.fill || 0.72);
          await moveCursor(page, tl, f.center.x, f.center.y, 600);
          await zoomTo(page, tl, step.level || f.level, step.ms || 900, opts, f.center);
        } else {
          // no selector: keep following the cursor
          await zoomTo(page, tl, step.level || 1.5, step.ms || 800, opts, null);
        }
        break;
      }
      case 'wait': {
        const ms = step.ms || 1000;
        if (ms > 2600) {
          // keep the cursor breathing during long holds
          await sleep(ms * 0.45);
          await moveCursor(page, tl, tl.pos.x + 26, tl.pos.y - 16, 800);
          const rest = ms * 0.55 - 800;
          await sleep(rest > 0 ? rest : 200);
        } else {
          await sleep(ms);
        }
        break;
      }
      default:
        throw new Error(`unknown action: ${step.action}`);
    }
    };

    try {
      try {
        await runStep();
      } catch (first) {
        // Recovery: pages settle late, hydrate, animate. Give the step one
        // more go after a beat before calling it a failure.
        tl.warnings.push(`step ${si + 1} (${step.action}) retried after: ${first.message.slice(0, 120)}`);
        await sleep(1200);
        await ensureOverlay(page, tl).catch(() => {});
        await runStep();
      }
    } catch (e) {
      if (step.optional) {
        tl.warnings.push(`step ${si + 1} (${step.action}) skipped: ${e.message}`);
      } else {
        // Enrich the error so an agent can self-repair: which step, where the
        // page actually is, and what the page really contains.
        let hint = '';
        if (/selector/i.test(e.message)) {
          const outline = await page.evaluate(pickOutline).catch(() => null);
          if (outline) hint = ` | page outline: ${JSON.stringify(outline).slice(0, 900)}`;
        }
        throw new Error(`step ${si + 1}/${steps.length} (${step.action}${step.selector ? ` ${step.selector}` : ''}) failed on ${page.url()}: ${e.message}${hint}`);
      }
    }
    await sleep(step.pause ?? 500);
  }
  await finishSegment();
  await zoomTo(page, tl, 1, 800, opts);
  await sleep(600);
}

async function extractOutline(page) {
  return page.evaluate(pickOutline);
}

module.exports = { autoTour, runSteps, extractOutline };
