import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { serveDocFile } = require('../src/main/doc-response');
const csp = "default-src 'self'; connect-src 'none'";
const source = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
function fixture(t, bytes = source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-doc-response-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'clip.mp4');
  fs.writeFileSync(file, bytes);
  const request = (headers = {}, method = 'GET') => serveDocFile(file, new Request('https://local.test/clip.mp4', { method, headers }), csp);
  return { root, file, request };
}

test('local media GET and HEAD expose exact size, type and policy', async t => {
  const { request } = fixture(t);
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), String(source.length));
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-security-policy'), csp);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  const head = await request({ Range: 'bytes=4-9' }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(source.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('media ranges support exact, open-ended, suffix and clamped reads', async t => {
  const { request } = fixture(t);
  for (const [range, start, end] of [['bytes=2-5', 2, 5], ['bytes=30-', 30, 35], ['bytes=-5', 31, 35], ['bytes=32-999', 32, 35], ['bytes=-999', 0, 35]]) {
    const response = await request({ Range: range });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${source.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source.subarray(start, end + 1));
  }
});

test('unsatisfiable ranges return 416 with the real file length', async t => {
  const { request } = fixture(t);
  for (const range of ['bytes=36-', 'bytes=-0', 'bytes=999999999999999999999999999999-']) {
    const response = await request({ Range: range });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */36');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('malformed, multipart, and unvalidated If-Range requests fall back to the whole file', async t => {
  const { request } = fixture(t);
  for (const headers of [{ Range: 'bytes=5-2' }, { Range: 'bytes=-' }, { Range: 'bytes=0-1,4-5' }, { Range: 'items=0-2' }, { Range: 'bytes=0-3', 'If-Range': '"old-version"' }]) {
    const response = await request(headers);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  }
});

test('empty files, missing files and directories are handled without a broken stream', async t => {
  const { file, root, request } = fixture(t, Buffer.alloc(0));
  const empty = await request();
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-length'), '0');
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
  assert.equal((await request({ Range: 'bytes=0-' })).status, 416);
  assert.equal((await serveDocFile(root, new Request('https://local.test/'), csp)).status, 404);
  fs.unlinkSync(file);
  assert.equal((await request()).status, 404);
});

test('local resources only allow reading', async t => {
  const { request } = fixture(t);
  const response = await request({}, 'POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('large media reads only the requested tail and supports cancelling a full response', async t => {
  const { file, request } = fixture(t);
  const size = 128 * 1024 * 1024, fd = fs.openSync(file, 'r+');
  fs.ftruncateSync(fd, size);
  fs.writeSync(fd, Buffer.from('tail'), 0, 4, size - 4);
  fs.closeSync(fd);
  const tail = await request({ Range: 'bytes=-4' });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${size - 4}-${size - 1}/${size}`);
  assert.equal(await tail.text(), 'tail');
  const full = await request();
  assert.equal(full.headers.get('content-length'), String(size));
  await full.body.cancel();
});
