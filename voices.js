// The voice catalogue, read straight from the installed Kokoro package so it
// can never drift from what the model can actually speak.

let cache = null;

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
  cache = out;
  return out;
}

const gradeRank = g => {
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
    lines.push(`\n${lang}  (${vs.length} voices, best first)`);
    for (const v of vs) {
      lines.push(`  ${v.id.padEnd(13)} ${v.grade.padEnd(3)} ${v.gender.padEnd(7)} ${v.name}`);
    }
  }
  lines.push('\nUse with: --voice af_bella   (also --speed 0.9 to slow the delivery)');
  return lines.join('\n');
}

module.exports = { allVoices, ranked, isValid, suggest, format };
