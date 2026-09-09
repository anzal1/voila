// transformers.js caches models inside its own node_modules folder by default,
// so every voila upgrade (and every fresh npx hash) would re-download ~90MB.
// Pin the cache to a stable per-user directory instead.

const os = require('os');
const path = require('path');

const CACHE_DIR = process.env.VOILA_MODEL_DIR
  || path.join(os.homedir(), '.cache', 'voila', 'models');

let applied = false;
function useStableCache() {
  if (applied) return CACHE_DIR;
  try {
    const { env } = require('@huggingface/transformers');
    env.cacheDir = CACHE_DIR;
    applied = true;
  } catch { /* transformers not resolvable; kokoro will use its default */ }
  return CACHE_DIR;
}

module.exports = { useStableCache, CACHE_DIR };
