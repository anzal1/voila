// Cookie and consent banners ruin a demo: they sit in frame for the whole
// recording. Dismiss them before the camera rolls.
//
// Privacy first: we look for "reject" / "necessary only" before "accept", so
// the recorded session declines non-essential cookies wherever that choice
// exists. Accepting is only a last resort to clear the overlay.

const REJECT = [
  /^(reject|decline|refuse)( all)?$/i,
  /necessary (cookies )?only/i,
  /^only (essential|necessary|required)/i,
  /^(essential|required) (cookies )?only/i,
  /continue without accepting/i,
  /^reject non-essential/i,
];

const ACCEPT = [
  /^(accept|allow|agree)( all| cookies)?$/i,
  /^(ok|got it|i understand|understood)$/i,
  /^(dismiss|close)$/i,
];

// Runs in the page. Returns the label it clicked, or null.
const dismissInPage = ([rejectSrc, acceptSrc]) => {
  const toRe = arr => arr.map(([s, f]) => new RegExp(s, f));
  const reject = toRe(rejectSrc), accept = toRe(acceptSrc);

  const visible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 20 && r.height > 12 && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  // Only consider controls that live inside something banner-shaped, so we
  // never click an "Accept" button that is part of the product itself.
  const looksLikeBanner = el => {
    const box = el.closest('[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i],[class*="gdpr" i],[id*="gdpr" i],[aria-label*="cookie" i],[role="dialog"],[class*="banner" i]');
    if (box) return true;
    // Or a fixed-position bar pinned to an edge of the viewport.
    let n = el;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const r = n.getBoundingClientRect();
        if (r.width > innerWidth * 0.5 && (r.bottom > innerHeight * 0.6 || r.top < innerHeight * 0.4)) return true;
      }
    }
    return false;
  };

  const controls = [...document.querySelectorAll('button,a[role="button"],[role="button"],input[type="button"],input[type="submit"]')]
    .filter(visible).filter(looksLikeBanner);

  for (const patterns of [reject, accept]) {
    for (const el of controls) {
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
      if (!label || label.length > 40) continue;
      if (patterns.some(re => re.test(label))) { el.click(); return label; }
    }
  }
  return null;
};

async function dismissConsent(page, { selector = null, timeout = 2500 } = {}) {
  const results = [];
  if (selector) {
    const el = page.locator(selector).first();
    try {
      await el.waitFor({ state: 'visible', timeout });
      await el.click({ timeout: 2000 });
      results.push(`custom: ${selector}`);
    } catch { /* nothing matched the override */ }
  }

  const src = [
    REJECT.map(r => [r.source, r.flags]),
    ACCEPT.map(r => [r.source, r.flags]),
  ];

  // Banners often mount late, and some sites stack two of them.
  for (let attempt = 0; attempt < 3; attempt++) {
    let clicked = null;
    try {
      clicked = await page.evaluate(dismissInPage, src);
      for (const frame of page.frames()) {
        if (clicked || frame === page.mainFrame()) continue;
        clicked = await frame.evaluate(dismissInPage, src).catch(() => null);
      }
    } catch { /* page navigated mid-check */ }
    if (clicked) results.push(clicked);
    await page.waitForTimeout(attempt === 0 ? 700 : 500);
    if (!clicked && attempt > 0) break;
  }
  return results;
}

module.exports = { dismissConsent };
