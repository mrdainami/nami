import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  START, END, renderBlock, spliceBlock, readBlock, hasForeignSkillsSection,
  writePointers, pointerStatus, linkNative, STUB,
} = require('../src/main/pointer.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nami-ptr-')); }
function skill(slug, description) { return { slug, description }; }
const TWO = [skill('invoice-check', 'matching an invoice against its PO'), skill('meeting-notes', 'a transcript into decisions and owners')];

// ---- renderBlock ------------------------------------------------------------

test('the block names every skill, sorted, with its one-line description', () => {
  const b = renderBlock(TWO);
  assert.ok(b.startsWith(START));
  assert.ok(b.endsWith(END));
  assert.ok(b.indexOf('`invoice-check/`') < b.indexOf('`meeting-notes/`'), 'sorted by slug');
  assert.match(b, /matching an invoice against its PO/);
  assert.match(b, /Typing `\/name` means/);
});

test('the block says it is generated, so a second Skills section cannot claim authority', () => {
  assert.match(renderBlock(TWO), /[Gg]enerated from the `skills\/` folder/);
});

test('a skill with no description still gets a line, never a dangling dash', () => {
  const b = renderBlock([skill('bare', '')]);
  assert.match(b, /- `bare\/`\n/);
  assert.ok(!/`bare\/` —\s*\n/.test(b), 'no empty em-dash');
});

test('renderBlock sorts by slug and is a pure function of its input', () => {
  const a = renderBlock([skill('b', 'B'), skill('a', 'A')]);
  assert.equal(a, renderBlock([skill('a', 'A'), skill('b', 'B')]));
});

test('a description spanning lines is flattened, so one skill is always one line', () => {
  const b = renderBlock([skill('multi', 'first part\nsecond part')]);
  const lines = b.split('\n').filter((l) => l.startsWith('- `multi/`'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /first part second part/);
});

// ---- spliceBlock: the contract ---------------------------------------------

test('no markers: the block is appended at the end, never mid-file', () => {
  const before = '# Working on Acme\n\nWe ship on Fridays.\n';
  const after = spliceBlock(before, renderBlock(TWO));
  assert.ok(after.startsWith(before.trimEnd()), 'the original prose leads');
  assert.ok(after.indexOf(START) > after.indexOf('We ship on Fridays'), 'block goes last');
});

test('markers present: only the lines between them change, byte for byte', () => {
  const head = '# Acme\n\nHouse rules. Do not touch.\n\n';
  const tail = '\n\n## Deploy notes\n\nFridays only.\n';
  const first = head + renderBlock([skill('one', 'the first')]) + tail;
  const second = spliceBlock(first, renderBlock(TWO));
  assert.ok(second.startsWith(head), 'everything above the markers survives');
  assert.ok(second.endsWith(tail), 'everything below the markers survives');
  assert.ok(!second.includes('the first'), 'the old list is gone');
  assert.match(second, /invoice-check/);
  assert.equal(second.match(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length, 1);
});

test('writing twice with nothing changed is byte-identical', () => {
  const block = renderBlock(TWO);
  const once = spliceBlock('# Acme\n\nprose\n', block);
  const twice = spliceBlock(once, block);
  assert.equal(twice, once);
  assert.equal(spliceBlock(twice, block), once);
});

test('an empty file gets the block and nothing else', () => {
  const out = spliceBlock('', renderBlock(TWO));
  assert.ok(out.startsWith(START));
  assert.equal(out.trimEnd().endsWith(END), true);
});

test('no skills left: the block is removed rather than left as an empty menu', () => {
  const withBlock = spliceBlock('# Acme\n\nprose\n', renderBlock(TWO));
  const emptied = spliceBlock(withBlock, renderBlock([]));
  assert.ok(!emptied.includes(START), 'a skills list with no skills is not worth keeping');
  assert.match(emptied, /# Acme/);
  assert.match(emptied, /prose/);
});

test('two start markers: refuse, because guessing which one is live is worse', () => {
  const doubled = renderBlock(TWO) + '\n\nstuff\n\n' + renderBlock(TWO);
  assert.throws(() => spliceBlock(doubled, renderBlock(TWO)), /more than one/i);
});

test('a start marker with no end: refuse rather than eat the rest of the file', () => {
  const broken = '# Acme\n\n' + START + '\n## Skills\n\nsomething\n';
  assert.throws(() => spliceBlock(broken, renderBlock(TWO)), /unclosed|marker/i);
});

test('CRLF files keep their line endings', () => {
  const before = '# Acme\r\n\r\nWe ship on Fridays.\r\n';
  const after = spliceBlock(before, renderBlock(TWO));
  assert.ok(after.includes('We ship on Fridays.\r\n'), 'existing CRLF prose is untouched');
});

// ---- readBlock --------------------------------------------------------------

test('readBlock returns the slugs the file currently announces', () => {
  const text = spliceBlock('# Acme\n', renderBlock(TWO));
  assert.deepEqual(readBlock(text), ['invoice-check', 'meeting-notes']);
  assert.deepEqual(readBlock('# Acme\n\nno block here\n'), []);
  assert.deepEqual(readBlock(''), []);
});

test('readBlock ignores a Skills section outside the markers', () => {
  const text = '## Skills\n\n- `hand-written/` — mine\n\n' + renderBlock([skill('generated', 'ours')]);
  assert.deepEqual(readBlock(text), ['generated']);
});

// ---- the hand-written section we must not eat -------------------------------

test('a hand-written Skills section is detected but never rewritten', () => {
  const mine = '# Acme\n\n## Skills\n\n- `build/` — my own wording\n';
  assert.equal(hasForeignSkillsSection(mine), true);
  const after = spliceBlock(mine, renderBlock(TWO));
  assert.match(after, /my own wording/, 'my prose survives verbatim');
  assert.match(after, /invoice-check/, 'and the block is appended below it');
  assert.equal(hasForeignSkillsSection(spliceBlock('# Acme\n', renderBlock(TWO))), false);
});

// ---- writePointers ----------------------------------------------------------

test('writePointers writes AGENTS.md plus a stub only where one is needed', () => {
  const dir = tmp();
  const res = writePointers({ dir, skills: TWO, agentIds: ['claude', 'codex', 'antigravity'] });
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.written.sort(), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /invoice-check/);
  const stub = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.match(stub, /AGENTS\.md/);
  assert.ok(stub.split('\n').filter(Boolean).length <= 3, 'a stub stays a stub');
  assert.equal(fs.existsSync(path.join(dir, 'CODEX.md')), false);
});

test('writePointers is idempotent — the second call changes no bytes', () => {
  const dir = tmp();
  const args = { dir, skills: TWO, agentIds: ['claude', 'codex'] };
  writePointers(args);
  const snap = ['AGENTS.md', 'CLAUDE.md'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const again = writePointers(args);
  assert.deepEqual(['AGENTS.md', 'CLAUDE.md'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')), snap);
  assert.deepEqual(again.written, [], 'nothing to write is reported as nothing written');
});

test('writePointers never overwrites a stub the user has grown into a real file', () => {
  const dir = tmp();
  const mine = '# My rules\n\nLots of my own guidance here.\n\nAnd more.\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), mine);
  writePointers({ dir, skills: TWO, agentIds: ['claude'] });
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), mine, 'an existing context file is left alone');
});

test('writePointers reports the diff before it is asked to write', () => {
  const dir = tmp();
  const plan = writePointers({ dir, skills: TWO, agentIds: ['claude', 'codex'], dryRun: true });
  assert.ok(plan.ok);
  assert.deepEqual(plan.written.sort(), ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false, 'a dry run writes nothing');
  assert.match(plan.preview['AGENTS.md'], /invoice-check/);
});

// ---- pointerStatus ----------------------------------------------------------

test('pointerStatus: everything announced is quiet, and the gap is named', () => {
  const dir = tmp();
  writePointers({ dir, skills: TWO, agentIds: ['claude', 'codex'] });
  const ok = pointerStatus({ dir, skills: TWO, agentIds: ['claude', 'codex'] });
  assert.equal(ok.inSync, true);
  assert.deepEqual(ok.unlisted, []);
  assert.deepEqual(ok.stale, []);
  assert.deepEqual(ok.missingFiles, []);

  const three = TWO.concat([skill('po-lookup', 'find a purchase order by supplier')]);
  const drifted = pointerStatus({ dir, skills: three, agentIds: ['claude', 'codex'] });
  assert.equal(drifted.inSync, false);
  assert.deepEqual(drifted.unlisted, ['po-lookup']);
});

test('pointerStatus names a skill the block still advertises after it is gone', () => {
  const dir = tmp();
  writePointers({ dir, skills: TWO, agentIds: ['codex'] });
  const st = pointerStatus({ dir, skills: [TWO[0]], agentIds: ['codex'] });
  assert.deepEqual(st.stale, ['meeting-notes']);
  assert.equal(st.inSync, false);
});

test('pointerStatus spots a missing stub, so a new agent gets noticed', () => {
  const dir = tmp();
  writePointers({ dir, skills: TWO, agentIds: ['codex'] });
  const st = pointerStatus({ dir, skills: TWO, agentIds: ['codex', 'antigravity'] });
  assert.deepEqual(st.missingFiles, ['GEMINI.md']);
  assert.equal(st.inSync, false);
});

test('pointerStatus on a folder with no skills and no files is in sync, not broken', () => {
  const st = pointerStatus({ dir: tmp(), skills: [], agentIds: ['claude', 'codex'] });
  assert.equal(st.inSync, true);
});

// ---- linkNative -------------------------------------------------------------

test('linkNative gives Claude a relative link into the one real folder', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'skills/meeting-notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/meeting-notes/SKILL.md'), '---\nname: meeting-notes\n---\nbody\n');
  const res = linkNative({ dir, slugs: ['meeting-notes'], agentIds: ['claude', 'codex'] });
  assert.ok(res.ok, res.error);
  const link = path.join(dir, '.claude/skills/meeting-notes');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), path.join('..', '..', 'skills', 'meeting-notes'), 'relative, so it survives a move or a clone');
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), 'and it resolves');
  assert.equal(fs.existsSync(path.join(dir, '.codex/skills')), false, 'only verified paths get one');
});

test('linkNative is idempotent and drops links whose skill has gone', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'skills/keep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/keep/SKILL.md'), 'x');
  linkNative({ dir, slugs: ['keep', 'gone'], agentIds: ['claude'] });
  assert.equal(fs.existsSync(path.join(dir, '.claude/skills/keep')), true);
  // "gone" was never a real folder, so its link dangles and must be swept
  const res = linkNative({ dir, slugs: ['keep'], agentIds: ['claude'] });
  assert.ok(res.ok);
  assert.equal(fs.lstatSync(path.join(dir, '.claude/skills/keep')).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(dir, '.claude/skills/gone')), false);
  assert.ok(!fs.readdirSync(path.join(dir, '.claude/skills')).includes('gone'), 'the dangling link is removed, not just unresolvable');
});

test('linkNative never touches a real folder someone put in .claude/skills by hand', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude/skills/hand-made'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude/skills/hand-made/SKILL.md'), 'mine\n');
  fs.mkdirSync(path.join(dir, 'skills/ours'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/ours/SKILL.md'), 'ours\n');
  linkNative({ dir, slugs: ['ours'], agentIds: ['claude'] });
  assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/hand-made/SKILL.md'), 'utf8'), 'mine\n');
  assert.equal(fs.lstatSync(path.join(dir, '.claude/skills/hand-made')).isSymbolicLink(), false);
});

// ---- the stub ---------------------------------------------------------------

test('the stub is three lines and points at AGENTS.md', () => {
  const lines = STUB.split('\n').filter(Boolean);
  assert.ok(lines.length <= 3, `stub grew to ${lines.length} lines`);
  assert.match(STUB, /AGENTS\.md/);
});
