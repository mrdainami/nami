import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkServer } = require('../src/main/mcp-check.js');

function fakeChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = { write: (line) => { const msg = JSON.parse(line); const reply = script(msg); if (reply) setImmediate(() => child.stdout.emit('data', Buffer.from(JSON.stringify(reply) + '\n'))); } };
  return child;
}

test('handshake then tools/list yields the tool count and kills the child', async () => {
  const child = fakeChild((msg) => {
    if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } };
    if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
    return null;
  });
  const out = await checkServer({ command: 'npx', args: ['x'], spawnFn: () => child });
  assert.deepEqual(out, { ok: true, tools: 3 });
  assert.ok(child.killed);
});

test('a server that never answers resolves ok:false at the timeout, not a hang', async () => {
  const child = fakeChild(() => null);
  const out = await checkServer({ command: 'npx', args: ['x'], spawnFn: () => child, timeoutMs: 50 });
  assert.equal(out.ok, false);
  assert.ok(child.killed);
});

test('spawn failure surfaces as a friendly error', async () => {
  const out = await checkServer({ command: 'nope', args: [], spawnFn: () => { throw new Error('ENOENT'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /ENOENT|could not start/i);
});

test('connector spawn receives only explicit keys; errors redact credentials', async () => {
  let actual;
  const out = await checkServer({ command: 'nope', parentEnv: { PATH: '/bin', OPENAI_API_KEY: 'ambient', PRIVATE_KEY: 'private' },
    settings: { envKeys: { PRIVATE_KEY: 'stored' } }, env: { SERVICE_TOKEN: 'explicit' },
    spawnFn: (_command, _args, opts) => { actual = opts.env; throw new Error('explicit private stored'); } });
  assert.deepEqual(actual, { PATH: '/bin', SERVICE_TOKEN: 'explicit' });
  assert.equal(out.error, 'could not start: [redacted] [redacted] [redacted]');
});

// ---- the Windows column -----------------------------------------------------
// Measured in the Windows 11 VM against @modelcontextprotocol/server-everything:
// a bare `npx` answered with 13 tools, `cmd /c npx` never answered at all, and
// a program that does not exist took the whole timeout to say so.

const answers = (n) => (msg) => {
  if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } };
  if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: Array.from({ length: n }, (_, i) => ({ name: 't' + i })) } };
  return null;
};

test('on a PC a cmd /c entry is started as the program inside it, not as cmd inside cmd', async () => {
  let line;
  const out = await checkServer({
    command: 'cmd', args: ['/c', 'npx', '-y', 'some-pkg'], platform: 'win32', parentEnv: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    spawnFn: (_file, args) => { line = args[args.length - 1]; return fakeChild(answers(2)); },
  });
  assert.deepEqual(out, { ok: true, tools: 2 });
  assert.equal(line, '"set NoDefaultCurrentDirectoryInExePath=1&& npx ^"-y^" ^"some-pkg^""');
});

test('on a Mac the same entry is spawned as written, as it always was', async () => {
  let seen;
  await checkServer({ command: 'cmd', args: ['/c', 'npx', 'x'], platform: 'darwin', spawnFn: (file, args) => { seen = [file, args]; return fakeChild(answers(0)); } });
  assert.deepEqual(seen, ['cmd', ['/c', 'npx', 'x']]);
});

test('on a PC a program that is not there says so at once, in cmd.exe\'s own words', async () => {
  const child = fakeChild(() => null);
  const pending = checkServer({ command: 'no-such-program', platform: 'win32', timeoutMs: 5000, spawnFn: () => child });
  child.stderr.emit('data', Buffer.from("'no-such-program' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n"));
  child.emit('close', 1);
  const t = Date.now();
  const out = await pending;
  assert.ok(Date.now() - t < 1000, 'did not wait for the timeout');
  assert.equal(out.ok, false);
  assert.match(out.error, /^could not start: 'no-such-program' is not recognized/);
});

test('a key in what the program printed is redacted like any other error', async () => {
  const child = fakeChild(() => null);
  const pending = checkServer({ command: 'npx', args: ['x'], platform: 'win32', env: { SERVICE_TOKEN: 'sekrit' }, timeoutMs: 5000, spawnFn: () => child });
  child.stderr.emit('data', Buffer.from('bad token sekrit\n'));
  child.emit('close', 1);
  assert.equal((await pending).error, 'could not start: bad token [redacted]');
});

test('on a Mac an early exit still waits out the timeout, as it always has', async () => {
  const child = fakeChild(() => null);
  const pending = checkServer({ command: 'npx', args: ['x'], platform: 'darwin', timeoutMs: 60, spawnFn: () => child });
  child.emit('close', 1);
  assert.match((await pending).error, /no answer within/);
});
