import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { grokAuthActions, GROK_API_KEY } from '../src/renderer/grok-auth.mjs';

const appSrc = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

test('the key Grok reads is XAI_API_KEY', () => {
  assert.equal(GROK_API_KEY, 'XAI_API_KEY');
});

test('signed out: account sign-in and paste a key', () => {
  const a = grokAuthActions({ signedIn: false });
  assert.equal(a.signInAccount, true);
  assert.equal(a.signOutAccount, false);
  assert.equal(a.switchToKey, false);
  assert.equal(a.pasteKey, true);
  assert.equal(a.pasteLabel, 'Use an API key');
  assert.equal(a.logoutAfterSave, false);
});

test('unknown status looks like signed out, not like an account', () => {
  const a = grokAuthActions(null);
  assert.equal(a.signInAccount, true);
  assert.equal(a.pasteKey, true);
  assert.equal(a.signOutAccount, false);
});

test('account, no stored key: sign out and paste (then logout so the key wins)', () => {
  const a = grokAuthActions({ signedIn: true, via: 'account', hasApiKey: false });
  assert.equal(a.signInAccount, false);
  assert.equal(a.signOutAccount, true);
  assert.equal(a.switchToKey, false);
  assert.equal(a.pasteKey, true);
  assert.equal(a.pasteLabel, 'Use an API key');
  assert.equal(a.logoutAfterSave, true);
});

test('account with a stored key: switch to it without re-pasting', () => {
  const a = grokAuthActions({ signedIn: true, via: 'account', hasApiKey: true });
  assert.equal(a.signOutAccount, true);
  assert.equal(a.switchToKey, true);
  assert.equal(a.pasteKey, false, 'the key is already stored; switching is logout');
  assert.equal(a.signInAccount, false);
});

test('already on the API key: can jump to the account or replace the key', () => {
  const a = grokAuthActions({ signedIn: true, via: 'api_key', hasApiKey: true });
  assert.equal(a.signInAccount, true);
  assert.equal(a.signOutAccount, false);
  assert.equal(a.switchToKey, false);
  assert.equal(a.pasteKey, true);
  assert.equal(a.pasteLabel, 'Replace API key');
  assert.equal(a.logoutAfterSave, false);
});

test('the Grok sheet and Keys pane both wire the helper', () => {
  assert.match(appSrc, /import \{ grokAuthActions, GROK_API_KEY \} from '\.\/grok-auth\.mjs'/);
  assert.match(appSrc, /grokAuthActions\(st\)/);
  assert.match(appSrc, /name: GROK_API_KEY/);
  assert.match(appSrc, /Sign in with xAI account/);
  assert.match(appSrc, /logoutAfterSave/);
});
