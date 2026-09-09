// Auth: voila never handles credentials. It opens a real browser window, the
// person signs in themselves, and the logged-in session persists in a local
// Chromium profile directory that only ever lives on their machine.

// Heuristic: does this page look like a sign-in wall rather than the product?
const LOGIN_MARKERS = /\b(sign in|log ?in|continue with|forgot password|create account)\b/i;

async function detectAuthWall(page) {
  try {
    const url = page.url();
    const signal = await page.evaluate(() => {
      const pw = document.querySelectorAll('input[type="password"]').length;
      const oauth = [...document.querySelectorAll('a,button')]
        .filter(e => /continue with|sign in with/i.test(e.textContent || '')).length;
      const bodyLen = (document.body?.innerText || '').length;
      const head = (document.body?.innerText || '').slice(0, 400);
      return { pw, oauth, bodyLen, head };
    });
    const urlLooksAuth = /\/(login|signin|sign-in|auth|account\/login)(\/|\?|$)/i.test(url);
    // A password box, or an OAuth-only wall on a nearly empty page.
    const isWall = signal.pw > 0
      || (signal.oauth > 0 && signal.bodyLen < 1200)
      || (urlLooksAuth && LOGIN_MARKERS.test(signal.head));
    return isWall ? { isWall: true, url } : { isWall: false };
  } catch {
    return { isWall: false };
  }
}

// Open a real browser window on `url` and hold it open until the person has
// signed in. Returns once they confirm, or once the page leaves the auth wall.
async function login(session, url, { onStatus = () => {} } = {}) {
  session.headless = false;
  const page = await session.open(url);
  onStatus('browser open: sign in in that window');

  const done = new Promise(resolve => {
    // Preferred: the person presses Enter when finished.
    if (process.stdin.isTTY) {
      process.stdin.setEncoding('utf8');
      process.stdin.resume();
      const onData = () => { process.stdin.pause(); resolve('confirmed'); };
      process.stdin.once('data', onData);
    }
  });

  // Fallback for non-interactive callers: poll until the auth wall is gone.
  const watched = (async () => {
    for (let i = 0; i < 600; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (page.isClosed()) return 'window closed';
      const wall = await detectAuthWall(page);
      if (!wall.isWall && i > 3) return 'signed in';
    }
    return 'timed out after 10 minutes';
  })();

  const reason = await Promise.race([done, watched]);
  const finalUrl = page.isClosed() ? url : page.url();
  await session.close();
  return { reason, profileDir: session.profileDir, finalUrl };
}

module.exports = { login, detectAuthWall };
