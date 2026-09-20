// Coming back where you left off, on a platform where closing the window quits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { rememberedWindows } = createRequire(import.meta.url)('../src/main/window-memory.js');

const A = { folder: 'C:\\work\\site', bounds: { x: 0, y: 0, width: 1200, height: 800 } };
const B = { folder: 'C:\\work\\api', bounds: { x: 40, y: 40, width: 900, height: 700 } };

test('on Windows the last window to close is the one a relaunch brings back', () => {
  assert.deepEqual(rememberedWindows({ open: [], lastClosed: A, platform: 'win32' }), [A]);
  assert.deepEqual(rememberedWindows({ open: [], lastClosed: A, platform: 'linux' }), [A]);
});

test('a window closed while others stay open is still gone for good', () => {
  assert.deepEqual(rememberedWindows({ open: [B], lastClosed: A, platform: 'win32' }), [B]);
});

test('a Mac is untouched: closing is not quitting there, so nothing is resurrected', () => {
  assert.deepEqual(rememberedWindows({ open: [], lastClosed: A, platform: 'darwin' }), []);
  assert.deepEqual(rememberedWindows({ open: [A, B], lastClosed: null, platform: 'darwin' }), [A, B]);
});

test('nothing closed, nothing invented', () => {
  assert.deepEqual(rememberedWindows({ open: [], lastClosed: null, platform: 'win32' }), []);
});
