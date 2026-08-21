import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Take three's drawer button called library:importAgent — a handler a patch
// script claimed to register and silently had not. The button rejected with
// "No handler registered" and 805 tests stayed green. This test is the
// mechanical version of clicking every button: any library:* channel the
// preload exposes must have a matching ipcMain.handle in main.js.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainSrc = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8');

test('every library channel the preload invokes has a registered handler', () => {
  const invoked = [...preloadSrc.matchAll(/ipcRenderer\.invoke\('(library:[^']+)'/g)].map((m) => m[1]);
  assert.ok(invoked.length > 0, 'preload should expose library channels');
  for (const ch of invoked) {
    assert.ok(
      mainSrc.includes(`ipcMain.handle('${ch}'`),
      `${ch} is invoked by the preload but never registered in main.js`,
    );
  }
});

test('the local browser-file action is paired across preload and main', () => {
  assert.match(preloadSrc, /openFileInBrowser:\s*\(file\)\s*=>\s*ipcRenderer\.invoke\('file:openBrowser', file\)/);
  assert.match(mainSrc, /ipcMain\.handle\('file:openBrowser'/);
});

test('the plain folder chooser is paired across preload and main', () => {
  assert.match(preloadSrc, /chooseFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('folder:choose'\)/);
  assert.match(mainSrc, /ipcMain\.handle\('folder:choose'/);
});

test('term session-id discovery is paired across preload and main', () => {
  // main discovers a terminal agent tile's conversation id and pushes it; the
  // preload must listen on the same channel or the id is never saved.
  assert.match(preloadSrc, /onTermSessionId:.*ipcRenderer\.on\('term:session-id'/);
  assert.match(mainSrc, /'term:session-id'/);
});

test('agents:status hands stored Keys to grok so an API key counts as signed in', () => {
  assert.match(mainSrc, /ipcMain.handle\('agents:status'/);
  assert.match(mainSrc, /agentStatus\(id,\s*\{\s*envKeys:\s*storedEnvKeys\(\)\s*\}/);
});
