// The pointer: what makes one skill folder usable by every agent.
//
// A skill is a folder — `<project>/skills/<name>/SKILL.md`. Nothing about it is
// agent-specific, so the only question is how each agent learns it exists. Every
// agent keeps skills somewhere of its own (~/.claude/skills, ~/.codex/skills,
// ~/.hermes/skills…), and writing into all of them would mean one copy per agent
// drifting apart on the first edit. Instead the project announces its skills in
// the file each agent already opens on startup: AGENTS.md, plus a three-line
// redirect for the two that only read their own name.
//
// Pure fs, no Electron imports, so the contract below is unit-testable.
//
// The contract, and it has no branches — which is the point. A write path that
// inspects your prose and then decides differently is a surprise waiting for
// someone else's repo.
//
//   no markers        → append the block once, at the end
//   markers present   → replace only what sits between them
//   nothing changed   → write nothing at all
//   two start markers → refuse; guessing which is live is worse than stopping
//
// Everything outside the markers round-trips byte for byte. That is what earns
// the right to write into a file the user also edits by hand.

const fs = require('fs');
const path = require('path');
const { KNOWN_AGENTS, POINTER_FILE, contextFilesFor } = require('./agents-detect.js');

const START = '<!-- nami:skills start -->';
const END = '<!-- nami:skills end -->';

// Three lines, and they buy something specific: Nami never has to be right about
// which agents read AGENTS.md on their own. Where one already does, this is
// harmless duplication; where it doesn't, this is the reason the skill works.
const STUB = `# Project notes\nRead AGENTS.md — the working rules and the list of skills are there.\n`;

// ---- the block --------------------------------------------------------------

// One line per skill, because a skill the model never learns exists is a skill
// that never fires. Four of the seven agents discover skills natively and inject
// name *and* description automatically; a bare signpost would give them less
// than they'd have had alone.
function renderBlock(skills) {
  const rows = (skills || [])
    .filter((s) => s && s.slug)
    .slice()
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    .map((s) => {
      const desc = oneLine(s.description);
      return desc ? `- \`${s.slug}/\` — ${desc}` : `- \`${s.slug}/\``;
    });
  if (!rows.length) return '';
  return [
    START,
    '## Skills',
    '',
    'Reusable procedures live in `skills/`. Each is a folder holding a',
    '`SKILL.md`. Read the one whose trigger matches before starting.',
    '',
    ...rows,
    '',
    'Typing `/name` means: read `skills/name/SKILL.md` and follow it. Anything',
    'after the name is the request.',
    '',
    'This list is generated from the `skills/` folder — edit the SKILL.md files,',
    'not these lines.',
    END,
  ].join('\n');
}

// A description is one line here even when the frontmatter wrapped it, so the
// list stays scannable and a stray newline can never break the block's shape.
function oneLine(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// ---- splicing ---------------------------------------------------------------

function findMarkers(text) {
  const starts = [];
  let at = text.indexOf(START);
  while (at !== -1) { starts.push(at); at = text.indexOf(START, at + START.length); }
  if (starts.length > 1) throw new Error('AGENTS.md has more than one Nami skills block — remove the extra one and try again.');
  if (!starts.length) return null;
  const end = text.indexOf(END, starts[0]);
  if (end === -1) throw new Error('AGENTS.md has an unclosed Nami skills marker — restore or remove it and try again.');
  return { start: starts[0], end: end + END.length };
}

// A file's line endings are its own. We render with \n and adopt whatever the
// file already uses, so editing a CRLF AGENTS.md doesn't quietly rewrite every
// line it touches — and doesn't show up as a whole-file diff in git.
function eolOf(src) { return /\r\n/.test(src) ? '\r\n' : '\n'; }
function withEol(block, eol) { return eol === '\n' ? block : block.replace(/\n/g, eol); }

// Returns the new text, or the text unchanged when there is nothing to do.
function spliceBlock(text, rawBlock) {
  const src = String(text == null ? '' : text);
  const eol = eolOf(src);
  const block = withEol(rawBlock, eol);
  const found = findMarkers(src);
  if (found) {
    const current = src.slice(found.start, found.end);
    if (current === block) return src;
    if (!block) {
      // A skills list with no skills is not worth keeping. Take the trailing
      // blank line with it so removing the last skill leaves a tidy file.
      const before = src.slice(0, found.start).replace(/(\r?\n)+$/, '');
      const after = src.slice(found.end).replace(/^(\r?\n)+/, '');
      return after ? before + eol + eol + after : before + eol;
    }
    return src.slice(0, found.start) + block + src.slice(found.end);
  }
  if (!block) return src;
  if (!src.trim()) return block + eol;
  // Only trailing blank lines go — the last real line keeps the ending it had.
  return src.replace(/(\r?\n)+$/, '') + eol + eol + block + eol;
}

// What the file currently advertises. Read back rather than remembered: there is
// no ledger to drift, because the answer is already written down.
function readBlock(text) {
  let found = null;
  try { found = findMarkers(String(text == null ? '' : text)); } catch (_) { return []; }
  if (!found) return [];
  const inner = String(text).slice(found.start, found.end);
  return [...inner.matchAll(/^- `([^`\/]+)\/?`/gm)].map((m) => m[1]);
}

// A `## Skills` heading the user wrote themselves. Worth knowing about — two
// Skills sections in one file is confusing — but never worth rewriting: their
// wording is usually better than anything generated from frontmatter.
function hasForeignSkillsSection(text) {
  const src = String(text == null ? '' : text);
  let found = null;
  try { found = findMarkers(src); } catch (_) { found = null; }
  const outside = found ? src.slice(0, found.start) + src.slice(found.end) : src;
  return /^#{1,6}\s+skills\b/im.test(outside);
}

// ---- writing ----------------------------------------------------------------

function writePointers({ dir, skills, agentIds, dryRun } = {}) {
  if (!dir) return { ok: false, error: 'No folder open.', written: [], preview: {} };
  const files = contextFilesFor(agentIds);
  const block = renderBlock(skills);
  const written = [];
  const preview = {};
  try {
    for (const file of files) {
      const abs = path.join(dir, file);
      const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      // Only AGENTS.md carries the block. The others are one-time redirects, and
      // a context file the user has grown into something real is left alone —
      // it already leads here, or they chose that it shouldn't.
      const next = file === POINTER_FILE ? spliceBlock(existing || '', block) : (existing === null ? STUB : existing);
      if (existing === next) continue;
      preview[file] = next;
      written.push(file);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, next);
      }
    }
  } catch (e) { return { ok: false, error: e.message, written, preview }; }
  return { ok: true, written, preview };
}

// ---- status ----------------------------------------------------------------

// Silent when healthy: if every skill is announced and every file is present
// there is nothing to say, and a line that always says the same thing is noise.
function pointerStatus({ dir, skills, agentIds } = {}) {
  const blank = { inSync: true, unlisted: [], stale: [], missingFiles: [], listed: [], error: '' };
  if (!dir) return blank;
  const have = (skills || []).filter((s) => s && s.slug).map((s) => s.slug);
  const files = contextFilesFor(agentIds);
  const missingFiles = files.filter((f) => !fs.existsSync(path.join(dir, f)));
  let listed = [];
  let error = '';
  const abs = path.join(dir, POINTER_FILE);
  if (fs.existsSync(abs)) {
    const text = safeRead(abs);
    try { findMarkers(text); } catch (e) { error = e.message; }
    listed = readBlock(text);
  }
  // With no skills at all there is nothing to announce, so a folder that has
  // never been touched is in sync rather than broken.
  if (!have.length && !listed.length) return { ...blank, missingFiles: [] };
  const unlisted = have.filter((s) => !listed.includes(s));
  const stale = listed.filter((s) => !have.includes(s));
  return {
    inSync: !unlisted.length && !stale.length && !missingFiles.length && !error,
    unlisted, stale, missingFiles, listed, error,
  };
}

function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }

// ---- native registration ---------------------------------------------------

// A pointer-listed skill is read as prose and followed. A skill in an agent's own
// skills folder is *registered* — its description lands in context automatically.
// Both work; the second is stronger, and one relative symlink buys it without a
// second copy of the file.
//
// These are not the links that rot. Those are absolute, cross-tool, and aimed at
// a home directory that moved. These are relative, inside one project, one level
// deep, created and removed by the same code that creates and removes the skill.
function linkNative({ dir, slugs, agentIds } = {}) {
  if (!dir) return { ok: false, error: 'No folder open.', linked: [], swept: [] };
  const ids = new Set(agentIds || []);
  const want = new Set(slugs || []);
  const linked = [];
  const swept = [];
  try {
    for (const agent of KNOWN_AGENTS) {
      if (!agent.projectSkillsDir || !ids.has(agent.id)) continue;
      const nativeDir = path.join(dir, agent.projectSkillsDir);
      const depth = agent.projectSkillsDir.split('/').filter(Boolean).length;
      const rel = path.join(...Array(depth).fill('..'), 'skills');
      for (const slug of want) {
        if (!fs.existsSync(path.join(dir, 'skills', slug, 'SKILL.md'))) continue;
        const at = path.join(nativeDir, slug);
        const target = path.join(rel, slug);
        if (isLink(at)) {
          if (readLink(at) === target && fs.existsSync(path.join(at, 'SKILL.md'))) continue;
          fs.rmSync(at, { recursive: true, force: true });
        } else if (fs.existsSync(at)) {
          continue;  // a real folder someone put here by hand is theirs, not ours
        }
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.symlinkSync(target, at);
        linked.push(path.join(agent.projectSkillsDir, slug));
      }
      // Sweep our own leftovers: a link into skills/ whose skill has gone. Only
      // links are ever removed, and only ones pointing back at skills/.
      for (const name of safeList(nativeDir)) {
        const at = path.join(nativeDir, name);
        if (!isLink(at)) continue;
        const to = readLink(at);
        if (!to.split(path.sep).includes('skills')) continue;
        if (want.has(name) && fs.existsSync(path.join(at, 'SKILL.md'))) continue;
        if (want.has(name)) continue;
        fs.rmSync(at, { force: true });
        swept.push(path.join(agent.projectSkillsDir, name));
      }
    }
  } catch (e) { return { ok: false, error: e.message, linked, swept }; }
  return { ok: true, linked, swept };
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch (_) { return false; } }
function readLink(p) { try { return fs.readlinkSync(p); } catch (_) { return ''; } }
function safeList(dir) { try { return fs.readdirSync(dir); } catch (_) { return []; } }

module.exports = {
  START, END, STUB, POINTER_FILE,
  renderBlock, spliceBlock, readBlock, hasForeignSkillsSection,
  writePointers, pointerStatus, linkNative,
};
