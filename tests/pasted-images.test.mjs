import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storePng } from '../src/main/pasted-images.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zR8AAAAASUVORK5CYII=', 'base64');
test('pasted images have stable private paths and duplicate bytes reuse the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-pastes-test-'));
  try {
    const first=storePng(dir,png), second=storePng(dir,png);
    assert.equal(first,second); assert.deepEqual(fs.readFileSync(first),png);
    assert.equal(fs.readdirSync(dir).length,1);
    if(process.platform!=='win32') assert.equal(fs.statSync(first).mode & 0o777,0o600);
    assert.throws(()=>storePng(dir,Buffer.from('not png')),/PNG/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
