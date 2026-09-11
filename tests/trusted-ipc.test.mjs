import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { trustedAppSender, trustedIpc } = createRequire(import.meta.url)('../src/main/trusted-ipc');
test('privileged IPC accepts only the registered app document in its main frame', () => {
  const appUrl = 'file:///fixture/src/renderer/index.html';
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
