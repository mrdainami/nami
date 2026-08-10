// What is allowed to be public, checked rather than remembered.
//
// The repo went public with fourteen planning documents, a folder of agent
// definitions and ten megabytes of unused artwork in it, because nothing said
// otherwise. Ignore rules only ever block what somebody already thought of: a
// folder invented tomorrow — notes/, drafts/, experiments/ — is not on any list
// and `git add -A` takes it up without a word.
//
// So this works the other way round. Everything tracked must live somewhere
// named below; anything else fails until a person decides it belongs. The
// release workflow runs `npm test` as its gate, so a repo that has drifted
// cannot become a download.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

// Everything Nami is, everything that builds or explains it. Nothing else.
const ALLOWED_DIRS = new Set([
  'src',       // the program
  'tests',     // proof it works
  'docs',      // the design, and screenshots of the result
  'scripts',   // build helpers
  'build',     // icon and entitlements the installer needs
  '.github',   // the release workflow
]);
const ALLOWED_ROOT = new Set([
  'package.json', 'package-lock.json', 'electron-builder.yml',
  'README.md', 'LICENSE', 'CONTRIBUTING.md', '.gitignore',
]);

test('nothing is published from outside the folders that make Nami', () => {
  const stray = tracked.filter((f) => f.includes('/')
    ? !ALLOWED_DIRS.has(f.split('/')[0])
    : !ALLOWED_ROOT.has(f));
  assert.deepEqual(stray, [], stray.length
    ? `These are tracked but belong to no part of Nami:\n  ${stray.join('\n  ')}\n\n`
      + 'Working notes, agent definitions, scratch and source art go in a folder\n'
      + '.gitignore covers. If one of these really does belong to the product,\n'
      + 'add its folder to ALLOWED_DIRS in this file, deliberately.'
    : '');
});

// The mirror of the rule above, and the half people forget. An ignore rule
// written a shade too wide removes something silently, and a repo missing its
// licence or its contributing guide fails a reader as surely as one full of
// private notes.
test('everything a stranger needs is still here', () => {
  const required = ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'docs/design.md', 'package.json', 'electron-builder.yml'];
  const missing = required.filter((f) => !tracked.includes(f));
  assert.deepEqual(missing, [], `No longer published: ${missing.join(', ')}`);
});

// Path rules catch a key in a file called secrets.env. They do nothing about a
// key pasted into a source comment, which is how it usually happens.
test('no tracked file carries anything shaped like a credential', () => {
  const PATTERNS = [
    [/sk-ant-[A-Za-z0-9_-]{10,}/, 'an Anthropic key'],
    [/\bsk-[A-Za-z0-9]{20,}/, 'an OpenAI-style key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
    [/github_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
    [/(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,}['"]/i, 'a hardcoded credential'],
  ];
  const SKIP = /\.(png|jpg|jpeg|icns|woff2?|ico|gz)$|(^|\/)vendor\//;
  const hits = [];
  for (const f of tracked) {
    if (SKIP.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
    text.split('\n').forEach((line, i) => {
      for (const [re, what] of PATTERNS) {
        // this file names every pattern it looks for, and would otherwise find itself
        if (re.test(line) && f !== 'tests/repo-shape.test.mjs') hits.push(`${f}:${i + 1} looks like ${what}`);
      }
    });
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

// The other boundary. This one decides what reaches a user rather than a
// reader, and it is the stricter of the two: a file has to be inside src to
// ship at all. Widening it is a real decision, so it should not be possible to
// make by accident in a config nobody reads.
test('the installer still carries only src and package.json', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
  const block = yml.split(/^files:\s*$/m)[1] || '';
  const entries = [];
  for (const line of block.split('\n')) {
    if (/^\S/.test(line)) break;              // dedented: the files: block ended
    const m = /^\s+-\s*'?"?([^'"\n]+)'?"?\s*$/.exec(line);
    if (m) entries.push(m[1].trim().replace(/['"]$/, ''));
  }
  const includes = entries.filter((e) => !e.startsWith('!'));
  assert.ok(includes.length > 0, 'could not read the files: block in electron-builder.yml');
  assert.deepEqual(includes.sort(), ['package.json', 'src/**/*'],
    `The installer would now also carry: ${includes.filter((e) => !['src/**/*', 'package.json'].includes(e)).join(', ')}`);
});
