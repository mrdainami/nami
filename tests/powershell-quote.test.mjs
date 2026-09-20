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
