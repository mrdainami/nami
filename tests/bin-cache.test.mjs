import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rememberBins, knownBin, forgetBins, resolveClaudeExecutable } = require('../src/main/bin-cache.js');

// Detection already answers "where does this agent live" properly — it asks the
// user's interactive login shell and walks the documented install folders. The
// bug this module exists to kill is that nothing else could read that answer:
// the SDK adapter re-derived it from a hardcoded list of five paths, and the
// one-shot adapters spawned a bare name against a PATH cached at app start.

test('remembers the path of an agent detection found', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: '/Users/x/.nvm/versions/node/v22.22.0/bin/claude' }]);
  assert.equal(knownBin('claude'), '/Users/x/.nvm/versions/node/v22.22.0/bin/claude');
});

test('an agent that was not found is remembered as nothing', () => {
  forgetBins();
  rememberBins([{ id: 'hermes', found: false, path: '' }]);
  assert.equal(knownBin('hermes'), '');
});

// A scan that no longer finds an agent must clear it. Otherwise uninstalling an
// agent inside Nami leaves a path that spawns ENOENT for the rest of the run —
// worse than the bare name, which would at least fail the same way every time.
test('a later scan that loses an agent clears the old path', () => {
  forgetBins();
  rememberBins([{ id: 'kimi', found: true, path: '/opt/homebrew/bin/kimi' }]);
  rememberBins([{ id: 'kimi', found: false, path: '' }]);
  assert.equal(knownBin('kimi'), '');
});

test('an id nobody has scanned is empty, never undefined', () => {
  forgetBins();
  assert.equal(knownBin('nothing-like-this'), '');
  assert.equal(knownBin(''), '');
  assert.equal(knownBin(undefined), '');
});

// Callers use `knownBin(id) || 'agy'`, so anything falsy has to be the empty
// string and never a path-shaped lie.
test('junk in the scan result never becomes a path', () => {
  forgetBins();
  rememberBins([{ id: 'agy', found: true, path: null }, { id: 'codex', found: true }]);
  assert.equal(knownBin('agy'), '');
  assert.equal(knownBin('codex'), '');
});

test('a scan that is not a list leaves what is already known alone', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: '/usr/local/bin/claude' }]);
  rememberBins(null);
  rememberBins(undefined);
  assert.equal(knownBin('claude'), '/usr/local/bin/claude');
});

// The registry calls Google's agent `antigravity`; its adapter and every tile
// command call it `agy`. Whichever name a caller holds has to work, or the
// lookup misses and falls back to the bare name it was meant to replace.
test('an agent is findable by registry id and by program name', () => {
  forgetBins();
  rememberBins([{ id: 'antigravity', bin: 'agy', found: true, path: '/Users/x/.local/bin/agy' }]);
  assert.equal(knownBin('antigravity'), '/Users/x/.local/bin/agy');
  assert.equal(knownBin('agy'), '/Users/x/.local/bin/agy');
});

test('losing an agent clears both of its names', () => {
  forgetBins();
  rememberBins([{ id: 'antigravity', bin: 'agy', found: true, path: '/Users/x/.local/bin/agy' }]);
  rememberBins([{ id: 'antigravity', bin: 'agy', found: false, path: '' }]);
  assert.equal(knownBin('antigravity'), '');
  assert.equal(knownBin('agy'), '');
});

// A run tile types into the user's interactive shell, whose PATH can miss a
// binary the scan already located (nvm/npm-prefix conflicts drop the
// npm-global dir). The typed command gets the absolute path; anything the
// scan doesn't know passes through untouched.
test('resolveRunCommand swaps a known bare binary for its scanned path', () => {
  const { resolveRunCommand } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'codex', found: true, path: '/Users/x/.nvm/versions/node/v22/bin/codex' }]);
  assert.equal(resolveRunCommand('codex'), '/Users/x/.nvm/versions/node/v22/bin/codex');
  assert.equal(resolveRunCommand('codex resume th_1'), '/Users/x/.nvm/versions/node/v22/bin/codex resume th_1');
  assert.equal(resolveRunCommand('kimi -r s1'), 'kimi -r s1'); // unknown: untouched
  assert.equal(resolveRunCommand('npm test'), 'npm test');
  forgetBins();
});

test('a scanned path with awkward characters is quoted for the shell', () => {
  const { resolveRunCommand } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'codex', found: true, path: '/Users/x/My Tools/codex' }]);
  assert.equal(resolveRunCommand('codex resume t'), "'/Users/x/My Tools/codex' resume t");
  forgetBins();
});

// Chat uses spawn(), not a shell. A bare program name the scan already found
// becomes that path, unquoted. Absolute paths (the Claude adapter) and names
// the scan does not know stay as they arrived.
test('resolveSpawnProgram swaps a known bare name for the scanned path', () => {
  const { resolveSpawnProgram } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'grok', bin: 'grok', found: true, path: '/Users/x/.local/bin/grok' }]);
  assert.equal(resolveSpawnProgram('grok'), '/Users/x/.local/bin/grok');
  assert.equal(resolveSpawnProgram('kimi'), 'kimi');
  assert.equal(resolveSpawnProgram('npx'), 'npx');
  forgetBins();
});

test('resolveSpawnProgram leaves an absolute path alone', () => {
  const { resolveSpawnProgram } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: '/Users/x/.local/bin/claude' }]);
  assert.equal(
    resolveSpawnProgram('/opt/adapter/claude-agent-acp'),
    '/opt/adapter/claude-agent-acp',
  );
  forgetBins();
});

test('resolveSpawnProgram does not quote for the shell', () => {
  const { resolveSpawnProgram } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'grok', bin: 'grok', found: true, path: '/Users/x/My Tools/grok' }]);
  assert.equal(resolveSpawnProgram('grok'), '/Users/x/My Tools/grok');
  forgetBins();
});

test('resolveSpawnProgram survives the empty and the strange', () => {
  const { resolveSpawnProgram } = require('../src/main/bin-cache.js');
  assert.equal(resolveSpawnProgram(''), '');
  assert.equal(resolveSpawnProgram(undefined), '');
  assert.equal(resolveSpawnProgram('grok agent'), 'grok agent');
});

// ---- spawn flags -----------------------------------------------------------
// grok paints a full-screen TUI by default, which sits on top of the Nami
// theme instead of inside it; --minimal makes it print into the tile's own
// scrollback. The flag deliberately does NOT live on the panel's `command`:
// agentForCommand matches p.command against bare binary names, so the flag
// is added at spawn rather than stored on the panel.

test('withSpawnFlags gives grok --minimal and leaves every other agent alone', () => {
  const { withSpawnFlags } = require('../src/main/bin-cache.js');
  assert.equal(withSpawnFlags('grok'), 'grok --minimal');
  for (const other of ['codex', 'kimi', 'opencode', 'hermes', 'agy', 'claude', 'npm test']) {
    assert.equal(withSpawnFlags(other), other, `${other} must pass through untouched`);
  }
});

test('withSpawnFlags puts the flag before the agent\'s own arguments', () => {
  const { withSpawnFlags } = require('../src/main/bin-cache.js');
  // a restored tile resumes; grok must still be minimal when it does
  assert.equal(withSpawnFlags('grok --resume 01a0-22b6'), 'grok --minimal --resume 01a0-22b6');
  assert.equal(withSpawnFlags('codex resume th_1'), 'codex resume th_1');
});

test('withSpawnFlags never adds the same flag twice', () => {
  const { withSpawnFlags } = require('../src/main/bin-cache.js');
  assert.equal(withSpawnFlags('grok --minimal'), 'grok --minimal');
  assert.equal(withSpawnFlags(withSpawnFlags('grok')), 'grok --minimal');
  assert.equal(withSpawnFlags('grok --minimal --resume x'), 'grok --minimal --resume x');
});

test('withSpawnFlags survives the empty and the strange', () => {
  const { withSpawnFlags } = require('../src/main/bin-cache.js');
  assert.equal(withSpawnFlags(''), '');
  assert.equal(withSpawnFlags(undefined), '');
  assert.equal(withSpawnFlags('  '), '  ');
  // an absolute path is not a bare bin: flags are applied before resolution,
  // so this shape should never arrive — and if it does, it passes through
  assert.equal(withSpawnFlags('/Users/x/.local/bin/grok'), '/Users/x/.local/bin/grok');
});

// The composition main.js actually uses: flags first (while the head is still
// a bare name), then the path swap.
test('spawn flags compose with the scanned-path swap, in that order', () => {
  const { withSpawnFlags, resolveRunCommand } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'grok', bin: 'grok', found: true, path: '/Users/x/.local/bin/grok' }]);
  assert.equal(resolveRunCommand(withSpawnFlags('grok')), '/Users/x/.local/bin/grok --minimal');
  assert.equal(
    resolveRunCommand(withSpawnFlags('grok --resume s1')),
    '/Users/x/.local/bin/grok --minimal --resume s1',
  );
  forgetBins();
});

// ---- where the user's claude actually lives --------------------------------
// Term spawn uses this. The scan goes first; the hardcoded list is the floor.
const NVM = '/Users/x/.nvm/versions/node/v22.22.0/bin/claude';
const only = (...ok) => (p) => ok.includes(p);

test('a claude the scan found beats the hardcoded list', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  const exe = resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only(NVM, '/Users/x/.local/bin/claude') });
  assert.equal(exe, NVM);
});

test('nvm, volta, bun and mise installs stop reading as missing', () => {
  for (const p of [
    NVM,
    '/Users/x/.volta/bin/claude',
    '/Users/x/.bun/bin/claude',
    '/Users/x/.local/share/mise/installs/node/22/bin/claude',
  ]) {
    forgetBins();
    rememberBins([{ id: 'claude', found: true, path: p }]);
    assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only(p) }), p);
  }
});

test('an explicit CLAUDE_CODE_EXECUTABLE still beats everything', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  const env = { CLAUDE_CODE_EXECUTABLE: '/opt/mine/claude' };
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env, exists: only('/opt/mine/claude', NVM) }), '/opt/mine/claude');
});

test('with nothing scanned it behaves exactly as it did before', () => {
  forgetBins();
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/Users/x/.local/bin/claude') }), '/Users/x/.local/bin/claude');
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/opt/homebrew/bin/claude') }), '/opt/homebrew/bin/claude');
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: () => false }), null);
});

test('a remembered path that no longer exists falls through', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  const exe = resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/opt/homebrew/bin/claude') });
  assert.equal(exe, '/opt/homebrew/bin/claude');
});
