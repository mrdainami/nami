// One connector, two spellings: `npx -y pkg` and the `cmd /c npx -y pkg` a PC
// is often told to write. Everything here is pure, and platform is a
// parameter, so both columns are checked from one machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isCmdWrapped, unwrapCmd, wrapCmd, entryFor, sameServer, settleEntry } = require('../src/main/mcp-entry.js');

const BARE = { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } };
const WRAPPED = { command: 'cmd', args: ['/c', 'npx', '-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } };

test('the cmd /c wrapper is recognised however it was typed', () => {
  assert.equal(isCmdWrapped(WRAPPED), true);
  for (const e of [
    { command: 'cmd.exe', args: ['/c', 'npx', 'x'] },
    { command: 'CMD', args: ['/C', 'npx', 'x'] },
    { command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', 'npx', 'x'] },
  ]) assert.equal(isCmdWrapped(e), true, JSON.stringify(e));
  for (const e of [BARE, { command: 'cmd', args: ['/k', 'npx'] }, { command: 'cmd', args: ['/c'] }, { command: 'cmdlet', args: ['/c', 'npx'] }, { url: 'https://x' }, null, {}]) {
    assert.equal(isCmdWrapped(e), false, JSON.stringify(e));
  }
});

test('taking the wrapper off gives back the entry a Mac writes, and nothing else is touched', () => {
  assert.deepEqual(unwrapCmd(WRAPPED), BARE);
  assert.deepEqual(unwrapCmd({ command: 'cmd.exe', args: ['/d', '/s', '/c', 'npx', '-y', 'p'] }), { command: 'npx', args: ['-y', 'p'] });
  assert.equal(unwrapCmd(BARE), BARE);
  assert.deepEqual(unwrapCmd({ type: 'local', command: ['cmd', '/c', 'npx', '-y', 'p'], enabled: true }), { type: 'local', command: ['npx', '-y', 'p'], enabled: true });
  const remote = { url: 'https://mcp.example.com/mcp' };
  assert.equal(unwrapCmd(remote), remote);
});

test('only the npm family is wrapped: they are .cmd files, the rest are real programs', () => {
  assert.deepEqual(wrapCmd(BARE), WRAPPED);
  for (const c of ['npm', 'pnpm', 'pnpx', 'yarn']) assert.equal(wrapCmd({ command: c, args: ['x'] }).command, 'cmd', c);
  for (const e of [{ command: 'node', args: ['C:\\x\\dist\\index.js'] }, { command: 'uvx', args: ['p'] }, { command: 'C:\\tools\\npx.cmd', args: [] }, { url: 'https://x' }]) {
    assert.equal(wrapCmd(e), e, JSON.stringify(e));
  }
  // already wrapped stays as it is, never cmd /c cmd /c
  assert.equal(wrapCmd(WRAPPED), WRAPPED);
});

test('the wrapper is only ever written on a PC, and only where it was asked for', () => {
  assert.equal(entryFor(BARE, { platform: 'darwin', wrap: true }), BARE);
  assert.equal(entryFor(BARE, { platform: 'linux', wrap: true }), BARE);
  assert.equal(entryFor(BARE, { platform: 'win32', wrap: false }), BARE);
  assert.equal(entryFor(BARE, { platform: 'win32' }), BARE);
  assert.deepEqual(entryFor(BARE, { platform: 'win32', wrap: true }), WRAPPED);
});

test('a Mac spelling and a PC spelling of one server are the same server', () => {
  assert.equal(sameServer(BARE, WRAPPED), true);
  assert.equal(sameServer(WRAPPED, BARE), true);
  assert.equal(sameServer(BARE, { ...BARE }), true);
  // no env and an empty env are the same thing
  assert.equal(sameServer({ command: 'npx', args: ['p'] }, { command: 'cmd', args: ['/c', 'npx', 'p'], env: {} }), true);
  // key order in env is not a difference
  assert.equal(sameServer({ command: 'a', env: { X: '1', Y: '2' } }, { command: 'a', args: [], env: { Y: '2', X: '1' } }), true);
  // OpenCode's dialect is read too
  assert.equal(sameServer(
    { type: 'local', command: ['npx', '-y', 'p'], environment: { K: 'v' }, enabled: true },
    { type: 'local', command: ['cmd', '/c', 'npx', '-y', 'p'], environment: { K: 'v' }, enabled: true },
  ), true);
});

test('a different package, argument, key or address is a different server', () => {
  assert.equal(sameServer(BARE, { ...BARE, args: ['-y', 'other'] }), false);
  assert.equal(sameServer(BARE, { ...BARE, env: { NOTION_TOKEN: 'ntn_2' } }), false);
  assert.equal(sameServer(BARE, { url: 'https://x' }), false);
  assert.equal(sameServer({ url: 'https://x' }, { url: 'https://x' }), true);
  assert.equal(sameServer({ url: 'https://x' }, { url: 'https://y' }), false);
  assert.equal(sameServer(null, BARE), false);
});

test('a shared file keeps the spelling that starts on both machines', () => {
  // A PC about to write the wrapper over a teammate's Mac entry: leave it.
  assert.equal(settleEntry(BARE, WRAPPED), BARE);
  const oc = { type: 'local', command: ['npx', '-y', 'p'], enabled: true };
  assert.equal(settleEntry(oc, { type: 'local', command: ['cmd', '/c', 'npx', '-y', 'p'], enabled: true }), oc);
});

test('everything else is written as it always was', () => {
  assert.equal(settleEntry(undefined, BARE), BARE);
  assert.equal(settleEntry(undefined, WRAPPED), WRAPPED);
  // same spelling: the new one lands, exactly as before this rule existed
  const again = { ...BARE };
  assert.equal(settleEntry(BARE, again), again);
  // a wrapper replaced by the plain spelling: that one starts everywhere
  assert.equal(settleEntry(WRAPPED, BARE), BARE);
  // a new key is a real change, whatever the spelling
  const rekeyed = { ...WRAPPED, env: { NOTION_TOKEN: 'ntn_2' } };
  assert.equal(settleEntry(BARE, rekeyed), rekeyed);
});
