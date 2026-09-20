// PowerShell has five single quotes, not one.
//
// Its tokenizer takes U+2018, U+2019, U+201A and U+201B — the curly quotes a
// phone, a word processor or a pasted sentence is full of — as the same
// character as U+0027, opening and closing a string exactly as it does. Doubling
// only the plain one left the other four able to end the string early:
// `a’; Write-Output INJECTED #` ran Write-Output (measured in the Windows 11 VM,
// Windows PowerShell 5.1). Every place that writes a PowerShell string doubles
// all five, and PowerShell hands the program the original text back.
//
// The renderer cannot require main-process code, so it keeps its own copy of
// the rule. This file feeds both the same strings, which is what keeps them in
// step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shellQuote as rendererQuote } from '../src/renderer/file-kinds.mjs';

const require = createRequire(import.meta.url);
const { psQuote } = require('../src/main/platform.js');
const { shellQuote } = require('../src/main/claude-args.js');
const { rememberBins, forgetBins, resolveRunCommand } = require('../src/main/bin-cache.js');
const { connectorInstall } = require('../src/main/shell-chain.js');

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const QUOTES = ["'", '\u2018', '\u2019', '\u201A', '\u201B'];

// What PowerShell does with a single-quoted string: a doubled quote of any of
// the five kinds is one of the first of the pair, and a lone one ends it.
// Returns the text the program would get, or null if the string ended early.
function readBack(quoted) {
  if (!QUOTES.includes(quoted[0])) return null;
  let out = '';
  for (let i = 1; i < quoted.length; i++) {
    if (!QUOTES.includes(quoted[i])) { out += quoted[i]; continue; }
    if (QUOTES.includes(quoted[i + 1])) { out += quoted[i]; i++; continue; }
    return i === quoted.length - 1 ? out : null;
  }
  return null;
}

const HOSTILE = [
  ...QUOTES.map((q) => `a${q}; Write-Output INJECTED #`),
  ...QUOTES.map((q) => `${q}${q} end${q}`),
  'O\u2019Brien\u2018s \u201Afolder\u201B',
  "it's \u2019mixed' \u2018up",
];

test('every one of PowerShell\'s single quotes is doubled, in main and in the renderer alike', () => {
  for (const text of HOSTILE) {
    const main = shellQuote(text, PS);
    assert.equal(readBack(main), text, main);
    assert.equal(psQuote(text), main);
    assert.equal(rendererQuote(text, 'win32'), main, 'the renderer and main must write the same string');
  }
  assert.equal(shellQuote('a\u2019; Write-Output INJECTED #', PS), "'a\u2019\u2019; Write-Output INJECTED #'");
});

test('the curly double quotes are left alone: inside single quotes they are text', () => {
  assert.equal(shellQuote('say \u201Chi\u201D', PS), "'say \u201Chi\u201D'");
});

test('a POSIX shell has one single quote, and its answer does not move', () => {
  assert.equal(shellQuote('a\u2019b', '/bin/zsh'), "'a\u2019b'");
  assert.equal(shellQuote("a'b", '/bin/zsh'), "'a'\\''b'");
  assert.equal(rendererQuote('a\u2019b', 'darwin'), "'a\u2019b'");
  assert.equal(rendererQuote("a'b", 'darwin'), "'a'\\''b'");
});

test('a program found under a folder with a curly quote in its name is still one string', () => {
  forgetBins();
  const found = 'C:\\Users\\O\u2019Brien; calc #\\npm\\codex.cmd';
  rememberBins([{ id: 'codex', found: true, path: found }]);
  const line = resolveRunCommand('codex resume abc', PS);
  forgetBins();
  assert.ok(line.startsWith('& ') && line.endsWith(' resume abc'), line);
  assert.equal(readBack(line.slice(2, -' resume abc'.length)), found);
});

test('a home folder with a curly quote in it cannot break out of a connector install', () => {
  const home = 'C:\\Users\\O\u2019Brien; calc #';
  const { steps, dir } = connectorInstall({ repo: 'https://github.com/a/b', home, platform: 'win32', shell: PS });
  assert.equal(readBack(steps[0].slice('git clone https://github.com/a/b '.length)), dir);
  assert.equal(readBack(steps[1].slice('Set-Location -LiteralPath '.length)), dir);
});

// ---- a quote on its way to a real program -----------------------------------
// Single quotes get a string into PowerShell whole. Getting it out again to a
// program is a second journey: Windows PowerShell 5.1 pastes the string into
// the command line, wraps it in "…" if it has a space after an even number of
// quotes, and escapes nothing, so `resize it to 5" wide & echo PWNED` reached
// node as `resize it to 5`, `wide`, `&`, `echo`, `PWNED` (measured in the VM
// through node-pty). No command runs — there is no cmd.exe here — but codex was
// handed five arguments where the Mac hands it one.
const { psNativeArg, PS_NATIVE_HEAD } = require('../src/main/platform.js');
const { withPromptArgs } = require('../src/main/seed-launch.js');

// What 5.1 puts on the command line for one string. It counts every quote,
// one after a backslash included: `"resize it to 5\" wide"` was wrapped a
// second time and arrived as nine words (measured in the VM).
function ps51Paste(s) {
  let quotes = 0, need = false;
  for (const c of s) {
    if (c === '"') quotes++;
    else if (/\s/.test(c) && quotes % 2 === 0) need = true;
  }
  return need ? `"${s}"` : s;
}
// And how the C runtime splits a command line back into arguments.
function crtSplit(line) {
  const out = []; let cur = '', inq = false, any = false, i = 0;
  while (i < line.length) {
    let n = 0; while (line[i] === '\\') { n++; i++; }
    if (line[i] === '"') { cur += '\\'.repeat(n >> 1); any = true; if (n % 2) cur += '"'; else if (inq && line[i + 1] === '"') { cur += '"'; i++; } else inq = !inq; i++; continue; }
    cur += '\\'.repeat(n);
    if (i >= line.length) break;
    if (!inq && /[ \t]/.test(line[i])) { if (cur || any) out.push(cur); cur = ''; any = false; i++; continue; }
    cur += line[i++];
  }
  if (cur || any) out.push(cur);
  return out;
}
// The two strings psNativeArg wrote: the one 5.1 pastes, and the one 7.3 and
// later hand over as it is.
function bothForms(written) {
  const m = /^\$\(if \(\$namiPastes\) \{([\s\S]*)\} else \{([\s\S]*)\}\)$/.exec(written);
  assert.ok(m, written);
  // the split between the two is wherever both halves read back as strings
  for (let at = written.indexOf('} else {'); at !== -1; at = written.indexOf('} else {', at + 1)) {
    const pasted = readBack(written.slice('$(if ($namiPastes) {'.length, at)), exact = readBack(written.slice(at + '} else {'.length, -2));
    if (pasted !== null && exact !== null) return { pasted, exact };
  }
  return assert.fail(written);
}
const TEXTS = ['resize it to 5" wide & echo PWNED', 'a&echo PWNED', '%USERNAME%', 'it\u2019s \u201Ccurly\u201D', 'trail\\', 'sp trail\\', 'a\\"b c', '"', '""', 'say "hi"', 'one " two " three " four', 'C:\\dir\\" x', 'x\\\\" y\\', 'line1\nline "2"', '--prompt=fix the "export" button', "} else {'x'}) ; Write-Output INJECTED #", '\u2019} else {\u2019'];

test('a string with a quote or a closing backslash reaches a program whole, through 5.1 and through 7.3 alike', () => {
  for (const text of TEXTS) {
    const { pasted, exact } = bothForms(psNativeArg(text));
    assert.deepEqual(crtSplit('node.exe x.js ' + ps51Paste(pasted)), ['node.exe', 'x.js', text], pasted);
    assert.equal(ps51Paste(pasted), pasted, 'and 5.1 leaves it as it was written');
    assert.equal(exact, text);
  }
  assert.equal(psNativeArg('say "hi"'), '$(if ($namiPastes) {\'"say ""hi"""\'} else {\'say "hi"\'})');
  assert.equal(psNativeArg('it\u2019s dir\\'), '$(if ($namiPastes) {\'"it\u2019\u2019s dir\\\\"\'} else {\'it\u2019\u2019s dir\\\'})');
});

test('a first message is added to a PowerShell line so that it arrives exactly, and to a POSIX one as ever', () => {
  const { shellQuote } = require('../src/main/claude-args.js');
  const ps = (a) => shellQuote(a, PS), sh = (a) => shellQuote(a, '/bin/zsh');
  // nothing awkward in it: the line everyone has always had
  assert.equal(withPromptArgs('codex', ['--', 'fix the export button'], { quote: ps, shell: PS }), "codex -- 'fix the export button'");
  assert.equal(withPromptArgs('codex', ['--', 'a&echo PWNED %USERNAME%'], { quote: ps, shell: PS }), "codex -- 'a&echo PWNED %USERNAME%'");
  assert.equal(withPromptArgs('codex', [], { quote: ps, shell: PS }), 'codex');
  // a quote, or a backslash at the end: the line first finds out which
  // PowerShell it is in, and the argument is written for both
  assert.equal(withPromptArgs('codex', ['--', 'say "hi"'], { quote: ps, shell: PS }), PS_NATIVE_HEAD + 'codex -- ' + psNativeArg('say "hi"'));
  assert.equal(withPromptArgs('opencode', ['--prompt=dir\\'], { quote: ps, shell: PS }), PS_NATIVE_HEAD + 'opencode ' + psNativeArg('--prompt=dir\\'));
  assert.equal(PS_NATIVE_HEAD, "$namiPastes = -not (Test-Path variable:PSNativeCommandArgumentPassing); $PSNativeCommandArgumentPassing = 'Standard'; ");
  // a Mac, where a quote inside single quotes was never anything but a quote
  for (const seed of TEXTS) assert.equal(withPromptArgs('codex', ['--', seed], { quote: sh, shell: '/bin/zsh' }), 'codex ' + ['--', seed].map(sh).join(' '));
  assert.equal(withPromptArgs('codex', ['--', 'say "hi"'], { quote: sh, shell: '/bin/zsh' }), "codex -- 'say \"hi\"'");
});
