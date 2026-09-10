import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { clampTermFont, TERM_FONT_DEFAULT } from '../src/renderer/tile-zoom.mjs';

const source = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
function harness(review = false, save = async () => ({ ok: true })) {
  const writes = [], notices = [], attrs = new Map();
  const ctx = vm.createContext({
    document: { body: { dataset: {}, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) } },
    THEME_NAMES: ['paper', 'operator', 'glass', 'graphite', 'soft', 'dusk'], DEFAULT_THEME: 'glass',
    GLASS_FAMILY: new Set(['glass', 'graphite']), SOFT_FAMILY: new Set(['soft', 'dusk']),
    THEME_KEY: 'theme', S: { review }, themeSaveVersion: 0,
    localStorage: { setItem: (k, v) => writes.push([k, v]), getItem: () => null },
    clampTermFont, TERM_FONT_DEFAULT, TERM_FONT_KEY: 'dainami-term-fontsize',
    api: { themeSet: async (name) => { writes.push(['ipc', name]); return save(name); }, themeApplied: () => {} },
    tileEls: new Map(), els: {}, toast: (s) => notices.push(s),
  });
  for (const name of ['normalizeTheme', 'currentTheme', 'applyThemeAttrs', 'setTheme', 'defaultTermFont']) {
    const fn = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
    if (fn) vm.runInContext(fn[0], ctx);
  }
  vm.runInContext(source.match(/function termFontOf\(p\) \{[^\n]+/)[0], ctx);
  return { ctx, writes, notices, attrs };
}

test('Paper round-trips as Paper, independently of the fresh-install default', () => {
  const { ctx } = harness();
  ctx.applyThemeAttrs('paper');
  assert.equal(ctx.currentTheme(), 'paper');
  assert.equal(ctx.document.body.dataset.theme, undefined);
});
test('all themes round-trip and invalid input applies the default consistently', () => {
  const { ctx, attrs } = harness();
  for (const name of ['graphite', 'dusk', 'paper', 'operator', 'glass', 'soft']) {
    ctx.applyThemeAttrs(name);
    assert.equal(ctx.currentTheme(), name);
    assert.equal(attrs.has('data-glass'), ['glass', 'graphite'].includes(name));
    assert.equal(attrs.has('data-soft'), ['soft', 'dusk'].includes(name));
  }
  ctx.applyThemeAttrs('retired-theme');
  assert.equal(ctx.document.body.dataset.theme, 'glass');
});
test('non-persistent overrides write neither theme store', async () => {
  const { ctx, writes } = harness();
  await ctx.setTheme('paper', false);
  assert.deepEqual(writes, []);
});
test('review choices are transient even when made through the normal setter', async () => {
  const { ctx, writes } = harness(true);
  await ctx.setTheme('dusk');
  assert.deepEqual(writes, []);
});
test('normal successful choices persist, but failed saves do not update the cache', async () => {
  const good = harness();
  await good.ctx.setTheme('paper');
  assert.deepEqual(good.writes, [['ipc', 'paper'], ['theme', 'paper']]);
  const bad = harness(false, async () => ({ ok: false }));
  await bad.ctx.setTheme('paper');
  assert.deepEqual(bad.writes, [['ipc', 'paper']]);
  assert.equal(bad.ctx.currentTheme(), 'paper');
  assert.equal(bad.notices.length, 1);
});

test('Operator uses a larger terminal default without changing other themes', () => {
  const { ctx } = harness();
  for (const theme of ['operator', 'paper', 'glass', 'graphite', 'soft', 'dusk', 'operator']) {
    ctx.applyThemeAttrs(theme);
    assert.equal(ctx.termFontOf({}), theme === 'operator' ? 14 : TERM_FONT_DEFAULT, theme);
  }
});

test('saved global and per-session terminal sizes win over the theme default', () => {
  const { ctx } = harness();
  ctx.localStorage.getItem = () => '12';
  for (const theme of ['operator', 'paper', 'operator']) {
    ctx.applyThemeAttrs(theme);
    assert.equal(ctx.termFontOf({}), 12);
    assert.equal(ctx.termFontOf({ fontSize: 16 }), 16);
  }
});

test('missing, invalid, or inaccessible preferences fall back to the current theme', () => {
  const { ctx } = harness();
  ctx.applyThemeAttrs('operator');
  for (const value of [null, '', 'nope', '9', '19']) {
    ctx.localStorage.getItem = () => value;
    assert.equal(ctx.termFontOf({ fontSize: 99 }), 14);
  }
  ctx.localStorage.getItem = () => { throw new Error('storage unavailable'); };
  assert.equal(ctx.termFontOf({}), 14);
  assert.equal(ctx.termFontOf({ fontSize: 11 }), 11);
});
