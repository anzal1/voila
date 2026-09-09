#!/usr/bin/env node
// voila CLI — same pipeline agents get via MCP.
//   voila outline <url> [--device mobile]
//   voila record <url> [--steps f.yaml] [--device mobile] [--voice name] [--no-narrate] [--headful] [--out dir]
//   voila review <video.mp4> [--frames 12] [--out dir]
//   voila login <url> [--profile dir]
//   voila voices
//   voila serve [--port 4477]
//   voila mcp

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const USAGE = `usage:
  voila outline <url> [--device desktop|mobile|tablet]
  voila record <url> [--steps f.yaml] [--device mobile] [--voice name] [--speed 1] [--no-narrate] [--headful] [--out dir] [--profile dir]
  voila review <video.mp4> [--frames 12] [--out dir]
  voila login <url> [--profile dir]     (sign in yourself; session is saved locally)
  voila voices                          (list every narration voice, best first)
  voila skill   (install the voila skill into ~/.claude/skills)
  voila serve   (web UI, PORT env or --port)
  voila mcp     (stdio MCP server)`;

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'serve') {
    if (arg('--port')) process.env.PORT = arg('--port');
    require('./server');
    return;
  }
  if (cmd === 'mcp') {
    require('./mcp');
    return;
  }
  if (cmd === 'voices') {
    console.log(require('./voices').format());
    return;
  }
  if (cmd === 'skill') {
    // Install the agent skill the way Clipy does: one command, lands in the
    // user's skills directory, every future session knows how to demo.
    const os = require('os');
    const src = path.join(__dirname, 'skills', 'voila', 'SKILL.md');
    const dest = path.join(os.homedir(), '.claude', 'skills', 'voila');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(src, path.join(dest, 'SKILL.md'));
    console.log(`✓ voila skill installed → ${path.join(dest, 'SKILL.md')}`);
    console.log('  New Claude Code sessions will pick it up automatically.');
    console.log('  Pair it with the MCP server: claude mcp add voila -- npx -y voila-recorder mcp');
    return;
  }
  if (cmd === 'review') {
    const video = process.argv[3];
    if (!video) { console.error(USAGE); process.exit(1); }
    const { reviewDemo } = require('./review');
    const result = await reviewDemo(video, {
      count: +(arg('--frames') || 12),
      outDir: arg('--out'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const url = process.argv[3];
  if (!cmd || !url || !['outline', 'record', 'login'].includes(cmd)) {
    console.error(USAGE);
    process.exit(1);
  }

  const { VoilaSession } = require('./recorder');
  const { produceDemo, outline } = require('./pipeline');
  const session = new VoilaSession({
    headless: !process.argv.includes('--headful'),
    device: arg('--device', 'desktop'),
    profileDir: arg('--profile', path.join(__dirname, 'profile')),
  });

  try {
    if (cmd === 'login') {
      const { login } = require('./auth');
      console.error('[voila] opening a browser window. Sign in there, then press Enter here.');
      const r = await login(session, url, { onStatus: m => console.error('[voila]', m) });
      console.error(`[voila] ${r.reason}. Session saved to ${r.profileDir}`);
      console.log(r.profileDir);
    } else if (cmd === 'outline') {
      console.log(JSON.stringify(await outline(session, url), null, 2));
    } else {
      const stepsFile = arg('--steps');
      const steps = stepsFile ? yaml.load(fs.readFileSync(stepsFile, 'utf8')) : null;
      const workDir = arg('--out', path.join(__dirname, 'recordings', `cli-${Date.now()}`));
      fs.mkdirSync(workDir, { recursive: true });
      const result = await produceDemo(session, {
        url, steps, workDir,
        narrate: !process.argv.includes('--no-narrate'),
        voice: arg('--voice'),
        speed: Number(arg('--speed', '1')) || 1,
        onStatus: s => console.error('[voila]', s),
      });
      console.log(result.video);
    }
  } finally {
    await session.close();
  }
})().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
