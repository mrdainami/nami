import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { trustedAppSender, trustedIpc } = createRequire(import.meta.url)('../src/main/trusted-ipc');
// A file URL this machine would really produce: on Windows that means a drive
// letter, without which a file URL is not a path at all.
const fileUrl = (...parts) => pathToFileURL(path.resolve('/fixture', ...parts)).href;
test('privileged IPC accepts only the registered app document in its main frame', () => {
  const appUrl = fileUrl('src', 'renderer', 'index.html');
  const sender = { isDestroyed: () => false, getURL: () => appUrl, mainFrame: { url: appUrl } };
  const window = { isDestroyed: () => false, webContents: sender }, windows = new Set([window]);
  const event = { sender, senderFrame: sender.mainFrame };
  assert.equal(trustedAppSender(event, windows, appUrl), true);
  assert.equal(trustedAppSender({ ...event, senderFrame: { url: appUrl } }, windows, appUrl), false);
  assert.equal(trustedAppSender(event, new Set(), appUrl), false);
  sender.getURL = () => 'https://example.test/';
  assert.equal(trustedAppSender(event, windows, appUrl), false);
  sender.getURL = () => appUrl; sender.mainFrame.url = 'about:blank';
  assert.equal(trustedAppSender(event, windows, appUrl), false);
});
test('rejected IPC never reaches a privileged action or discloses its result', () => {
  const handlers = new Map(), calls = [];
  const ipc = trustedIpc({ handle: (c, h) => handlers.set(c, h), on: (c, h) => handlers.set(c, h) }, e => e.trusted === true);
  ipc.handle('read', (_e, value) => { calls.push(value); return value; });
  ipc.on('write', (_e, value) => calls.push(value));
  assert.throws(() => handlers.get('read')({}, 'private fixture'), /only available from Nami/);
  handlers.get('write')({}, 'untrusted');
  assert.deepEqual(calls, []);
  assert.equal(handlers.get('read')({ trusted: true }, 'allowed fixture'), 'allowed fixture');
  assert.deepEqual(calls, ['allowed fixture']);
});
test('the app document is the same document however its path was percent-encoded', () => {
  // Node writes C:\Users\LONGNA~1\… as …/LONGNA%7E1/… and Chromium reports the
  // same file with the tilde bare. Compared letter for letter, a Nami running
  // from a Windows short path refused every one of its own windows and never
  // booted — which is exactly where the portable build unpacks itself.
  const node = fileUrl('LONGNA~1', 'src', 'renderer', 'index.html');
  const chromium = node.replace('%7E', '~');
  assert.match(node, /LONGNA%7E1/);   // the premise: Node really does encode it
  const sender = { isDestroyed: () => false, getURL: () => chromium, mainFrame: { url: chromium } };
  const windows = new Set([{ isDestroyed: () => false, webContents: sender }]);
  const event = { sender, senderFrame: sender.mainFrame };
  assert.equal(trustedAppSender(event, windows, node), true);
  sender.mainFrame.url = chromium + '#settings';
  assert.equal(trustedAppSender(event, windows, node), true);
  // Decoding must not widen the gate: another file, a query, a smuggled
  // separator and another scheme are all still somebody else.
  for (const other of [
    chromium.replace('index.html', 'other.html'),
    chromium + '?as=admin',
    chromium.replace('/index.html', '%2Findex.html'),
    chromium.replace('/index.html', '/guest/..%2Findex.html'),
    chromium.replace(/^file:\/\/\/?/, 'https://fixture/'),
  ]) {
    sender.getURL = () => other; sender.mainFrame.url = other;
    assert.equal(trustedAppSender(event, windows, node), false, other);
  }
});
