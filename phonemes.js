// Grapheme-to-phoneme for Kokoro's non-English voices.
//
// kokoro-js only ships an English phonemizer, which is why its 26 non-English
// voice files sat unusable. espeak-ng compiled to WASM carries the full
// language data, runs on every platform, and emits the IPA Kokoro was trained
// on. That combination gives real multilingual narration with no OS-specific
// dependency.

// Kokoro voice ids are prefixed by language: af_/am_ = American English,
// bf_/bm_ = British, ef_/em_ = Spanish, and so on.
const LANGS = {
  a: { espeak: 'en-us', name: 'English (US)', tier: 'native' },
  b: { espeak: 'en-gb', name: 'English (UK)', tier: 'native' },
  e: { espeak: 'es',    name: 'Spanish',      tier: 'good' },
  f: { espeak: 'fr-fr', name: 'French',       tier: 'good' },
  h: { espeak: 'hi',    name: 'Hindi',        tier: 'good' },
  i: { espeak: 'it',    name: 'Italian',      tier: 'good' },
  p: { espeak: 'pt-br', name: 'Portuguese (BR)', tier: 'good' },
  // espeak leaks English words into Japanese kanji, and emits numeric tones
  // for Mandarin that Kokoro was not trained on. Both need a dedicated G2P
  // (the Python release uses one); until then they are off by default.
  j: { espeak: 'ja',    name: 'Japanese',     tier: 'experimental' },
  z: { espeak: 'cmn',   name: 'Mandarin',     tier: 'experimental' },
};

const langOf = voiceId => LANGS[String(voiceId || '')[0]] || null;

let worker = null;
async function getWorker() {
  if (!worker) {
    const mod = await require('@echogarden/espeak-ng-emscripten').default();
    worker = await new mod.eSpeakNGWorker();
  }
  return worker;
}

// espeak separates phonemes with underscores and sentences with newlines.
// Kokoro wants a plain IPA string.
function tidy(ipa) {
  return ipa.replace(/_/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

async function phonemize(text, voiceId) {
  const lang = langOf(voiceId);
  if (!lang) throw new Error(`no language mapping for voice "${voiceId}"`);
  const w = await getWorker();
  w.set_voice(lang.espeak);
  return tidy(w.synthesize_ipa(text).ipa);
}

module.exports = { phonemize, langOf, LANGS };
