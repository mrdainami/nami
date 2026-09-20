import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);
const { OPEN_EXT } = require('../src/main/open-with.js');
const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const config = yaml.load(read('electron-builder.yml'));
const nsh = read('build/installer.nsh');
// What the script does, without what it says about itself.
const code = nsh.split('\n').filter((l) => !l.trim().startsWith(';')).join('\n');

// The Windows half of the rule the Mac list states with `rank: Alternate`.
test('the installer offers Nami under "Open with" for exactly the extensions open-with routes', () => {
  const added = [...code.matchAll(/!insertmacro NamiOpenWith "([^"]+)"/g)].map((m) => m[1]);
  const removed = [...code.matchAll(/!insertmacro NamiOpenWithRemove "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...added].sort(), [...OPEN_EXT].sort());
  assert.deepEqual([...removed].sort(), [...OPEN_EXT].sort(), 'an uninstall has to take back everything an install gave');
  assert.equal(config.nsis.include, 'build/installer.nsh');
});

test('installing Nami never takes a file type\'s default', () => {
  // The default is the unnamed value of Software\Classes\.ext. Every write to
  // an extension key has to be to OpenWithProgids underneath it.
  const extensionWrites = [...code.matchAll(/^\s*Write\w+\s+SHELL_CONTEXT\s+"Software\\Classes\\\.[^"]*"/gm)].map((m) => m[0]);
  assert.ok(extensionWrites.length > 0);
  for (const line of extensionWrites) assert.match(line, /\\OpenWithProgids"$/, line);
  assert.doesNotMatch(code, /UserChoice/);
  // electron-builder's own association macro writes that default value, and
  // its uninstaller never puts it back.
  assert.equal(config.win.fileAssociations, undefined);
  assert.equal(config.fileAssociations, undefined);
  assert.doesNotMatch(code, /APP_ASSOCIATE/);
});

test('an install folder with a space in it still opens the file', () => {
  const commands = [...code.matchAll(/shell\\open\\command" "" (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(commands.length >= 2);
  for (const c of commands) assert.equal(c, `'"$appExe" "%1"'`);
});

test('an update does not unregister what the new installer is about to register', () => {
  assert.match(code, /!macro customUnInstall\s+\$\{ifNot\} \$\{isUpdated\}/);
});

// `arch:` on a target beats the command line, so `dist:win -- --arm64` built
// x64 too — on an ARM machine, around the arm64 node-pty.
test('the Windows targets leave the arch to the command line', () => {
  assert.deepEqual(config.win.target, [{ target: 'nsis' }, { target: 'portable' }]);
});

// Platform `files` made of exclusions alone become the main file set with
// `**/*` in front, and the app ships the whole repo. Both platforms did.
test('no platform has its own files list; the onnxruntime cut is in the shared one', () => {
  for (const key of ['mac', 'win', 'linux', 'nsis', 'portable', 'dmg']) assert.equal(config[key]?.files, undefined, key);
  assert.ok(config.files.includes('!node_modules/onnxruntime-node/bin/napi-v3/!(${platform})/**'));
  assert.ok(config.files.includes('!node_modules/onnxruntime-node/bin/napi-v3/${platform}/!(${arch})/**'));
});

test('the Windows workflow stages the runtime, inspects what it built, and runs the security gate', () => {
  const steps = yaml.load(read('.github/workflows/windows.yml')).jobs.build.steps.map((s) => String(s.run || ''));
  const at = (re) => steps.findIndex((s) => re.test(s));
  const build = at(/npm run dist:win/);
  assert.ok(build >= 0);
  assert.ok(at(/stage-vc-runtime\.mjs \$\{\{ matrix\.arch \}\}/) >= 0 && at(/stage-vc-runtime/) < build, 'staged before the build');
  assert.ok(at(/check-bundle/) > build, 'checked after the build');
  assert.ok(at(/npm run check:security/) >= 0);
});
