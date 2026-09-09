// The voice catalogue, read straight from the installed Kokoro package so it
// can never drift from what the model can actually speak.

let cache = null;

// Voices the model ships, including the non-English ones kokoro-js leaves out
// of its metadata. Their language comes from the id prefix.
function shippedVoiceIds() {
  const fs = require('fs'), path = require('path');
  const dir = path.join(path.dirname(require.resolve('kokoro-js')), '..', 'voices');
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.bin')).map(f => f.replace('.bin', '')); }
  catch { return []; }
}

function allVoices() {
  if (cache) return cache;
  const fs = require('fs');
  // kokoro-js blocks deep subpath resolution, so locate the CJS bundle that
  // `require` itself resolves to.
  const bundle = require.resolve('kokoro-js');
  const src = fs.readFileSync(bundle, 'utf8');
  const re = /([a-z]{2}_[a-z]+):\{name:"([^"]+)",language:"([^"]+)",gender:"([^"]+)"(?:,traits:"[^"]*")?,targetQuality:"([^"]+)",overallGrade:"([^"]+)"\}/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({ id: m[1], name: m[2], language: m[3], gender: m[4], grade: m[6] });
  }
  // Fold in the non-English voices, which ship as files but carry no metadata.
  const { langOf } = require('./phonemes');
  const known = new Set(out.map(v => v.id));
  for (const id of shippedVoiceIds()) {
    if (known.has(id)) continue;
    const lang = langOf(id);
    if (!lang || lang.tier === 'native') continue;
    out.push({
      id,
      name: (id.split('_')[1] || id).replace(/^./, c => c.toUpperCase()),
      language: lang.name,
      gender: id[1] === 'f' ? 'Female' : id[1] === 'm' ? 'Male' : '',
      grade: lang.tier === 'experimental' ? 'experimental' : 'unrated',
      tier: lang.tier,
    });
  }
  for (const v of out) if (!v.tier) v.tier = 'native';
  cache = out;
  return out;
}

const gradeRank = g => {
  if (g === 'unrated') return 6;
  if (g === 'experimental') return 9;
  const base = { A: 0, B: 1, C: 2, D: 3, F: 4 }[g[0]] ?? 5;
  const mod = g[1] === '+' ? -0.3 : g[1] === '-' ? 0.3 : 0;
  return base + mod;
};

// Best first, so `voila voices` reads as a recommendation list.
function ranked() {
  return allVoices().slice().sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.id.localeCompare(b.id));
}

function isValid(id) {
  return allVoices().some(v => v.id === id);
}

function suggest(id) {
  const near = allVoices().filter(v => v.id.includes(String(id).replace(/^[a-z]{2}_/, '')));
  return (near.length ? near : ranked().slice(0, 4)).map(v => v.id);
}

function format() {
  const rows = ranked();
  const byLang = {};
  for (const v of rows) (byLang[v.language] = byLang[v.language] || []).push(v);
  const lines = [];
  for (const [lang, vs] of Object.entries(byLang)) {
    const tier = vs[0].tier;
    const note = tier === 'experimental' ? '  [experimental: pronunciation is unreliable]' : '';
    lines.push(`\n${lang}  (${vs.length} voices)${note}`);
    for (const v of vs) {
      lines.push(`  ${v.id.padEnd(13)} ${String(v.grade).padEnd(12)} ${v.gender.padEnd(7)} ${v.name}`);
    }
  }
  lines.push('\nAll of these run on-device on every platform.');
  lines.push('Use with: --voice ef_dora   (--speed 0.9 slows the delivery)');
  return lines.join('\n');
}

// --- system voices (macOS `say`) ---------------------------------------------
// Kokoro is English-only in JS (its other voice files ship without a
// grapheme-to-phoneme stage for those languages). Every Mac already carries
// ~180 voices across ~50 languages, so those cover non-English narration.

let sysCache = null;
function systemVoices() {
  if (sysCache) return sysCache;
  sysCache = [];
  if (process.platform !== 'darwin') return sysCache;
  try {
    const { execFileSync } = require('child_process');
    const out = String(execFileSync('say', ['-v', '?'], { maxBuffer: 4e6 }));
    for (const line of out.split('\n')) {
      const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s/.exec(line);
      if (m) sysCache.push({ id: `say:${m[1].trim()}`, name: m[1].trim(), language: m[2].replace('_', '-'), gender: '', grade: 'system' });
    }
  } catch { /* no say binary */ }
  return sysCache;
}

function systemLanguages() {
  const langs = {};
  for (const v of systemVoices()) (langs[v.language] = langs[v.language] || []).push(v.name);
  return langs;
}

function isSystemVoice(id) {
  if (!id) return false;
  const name = String(id).replace(/^say:/, '').toLowerCase();
  return systemVoices().some(v => v.name.toLowerCase() === name);
}

function formatAll() {
  const lines = [format()];
  const langs = systemLanguages();
  const codes = Object.keys(langs).sort();
  if (!codes.length) {
    lines.push('\nSystem voices: none found (macOS only). For other languages use --tts-cmd.');
    return lines.join('\n');
  }
  lines.push(`\nSystem voices (macOS, ${systemVoices().length} across ${codes.length} languages)`);
  for (const c of codes) lines.push(`  ${c.padEnd(7)} ${langs[c].slice(0, 6).join(', ')}${langs[c].length > 6 ? ` +${langs[c].length - 6}` : ''}`);
  lines.push('\nUse a system voice for non-English narration:  --voice "say:Monica"');
  lines.push('Any other engine:  --tts-cmd \'piper --model es.onnx -f {out} -- "{text}"\'');
  return lines.join('\n');
}

module.exports = { allVoices, ranked, isValid, suggest, format, formatAll, systemVoices, systemLanguages, isSystemVoice };
