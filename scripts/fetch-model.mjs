// Pulls the on-device Whisper weights into build/models so electron-builder can
// ship them inside the app. Without this the first dictation needs a network,
// which is exactly the thing the local engine exists to avoid.
// Run automatically before a package build; safe to re-run (it skips what it has).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const store = require('../src/main/stt-model.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'build', 'models');
const model = store.modelById(process.argv[2] || store.DEFAULT_MODEL);

console.log(`fetching ${model.repo} → ${path.relative(root, dir)}`);
const res = await store.ensureModel({
  dir, repo: model.repo,
  onProgress: ({ done, total, file }) => console.log(`  ${done}/${total} ${file}`),
});
console.log(res.cached ? 'already present' : 'done');
