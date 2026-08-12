import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startHereNote, seedStartHere, NOTE_NAME } = require('../src/main/start-here.js');

const temp = () => mkdtemp(join(tmpdir(), 'nami-start-here-'));

test('the note greets the folder by name', () => {
  const md = startHereNote('Invoices');
  assert.match(md, /Invoices/);
});

test('the note teaches the two things that stop people', () => {
  const md = startHereNote('Nami');
  // The boundary, stated as the promise itself. This is the sentence that earns
  // the trust the whole app runs on, so it is pinned: a rewrite that quietly
  // drops it should fail here rather than ship.
  assert.match(md, /nowhere else on your Mac/i);
  // The approval card, named exactly as the UI names it — a note that calls it
  // anything else sends people looking for a control that does not exist.
  assert.ok(md.includes('Needs your OK'), 'should name the approval card');
});

test('the note says Nami is not itself the agent', () => {
  const md = startHereNote('Nami');
  assert.match(md, /your own (Claude|ChatGPT)|subscription|account/i);
});

test('the note carries the full twelve example asks', () => {
  const md = startHereNote('Nami');
  const bullets = md.split('\n').filter((l) => /^[-*] /.test(l));
  // Twelve is not decoration: the quick start's row 4 button says "See 12
  // examples" and opens this note. If the list shrinks, that button starts
  // lying, so the count is pinned rather than left to drift.
  assert.ok(bullets.length >= 12, `expected 12+ example asks, got ${bullets.length}`);
});

test('seedStartHere writes the note into a new folder', async () => {
  const dir = await temp();
  const wrote = await seedStartHere(dir);
  assert.equal(wrote, true);
  const md = await readFile(join(dir, NOTE_NAME), 'utf8');
  assert.match(md, /Nami/);
});

test('seedStartHere never overwrites a note that is already there', async () => {
  const dir = await temp();
  await writeFile(join(dir, NOTE_NAME), 'mine, do not touch', 'utf8');
  const wrote = await seedStartHere(dir);
  assert.equal(wrote, false, 'should report that it wrote nothing');
  assert.equal(await readFile(join(dir, NOTE_NAME), 'utf8'), 'mine, do not touch');
});

test('seedStartHere reports false rather than throwing on an unwritable path', async () => {
  const dir = await temp();
  const missing = join(dir, 'no', 'such', 'place');
  assert.equal(await seedStartHere(missing), false);
});

test('the note is named so it sorts to the top of a file tree', async () => {
  const dir = await temp();
  await mkdir(join(dir, 'Archive'));
  await seedStartHere(dir);
  // "Start here.md" beats nothing alphabetically, so the tree gets an explicit
  // check that the name has not drifted to something like "welcome.md"
  assert.equal(NOTE_NAME, 'Start here.md');
});
