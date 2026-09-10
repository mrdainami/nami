// A link to an app scheme, a redirect that superseded itself, a resource the
// site blocked — Chromium reports each as a failed main-frame load while the
// page you were reading is still there. The tab used to show a red bar for
// every one of them: a popup that said "error" over a browser that worked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadFailureMessage } = require('../src/main/browser-policy');

const at = (failedUrl, currentUrl, code, description) => loadFailureMessage({ code, description, failedUrl, currentUrl });

test('a failure that left you on the page you were reading says nothing', () => {
  assert.equal(at('https://b.example/', 'https://a.example/', -2, 'ERR_FAILED'), null);
  assert.equal(at('https://b.example/', 'https://a.example/', -27, 'ERR_BLOCKED_BY_RESPONSE'), null);
});

test('a link that opens somewhere else is not an error', () => {
  assert.equal(at('mailto:x@y', 'https://a.example/', -302, 'ERR_UNKNOWN_URL_SCHEME'), null);
  assert.equal(at('https://b.example/', 'https://b.example/', -3, 'ERR_ABORTED'), null);
});

test('a failure you are actually looking at is explained in words', () => {
  assert.equal(at('https://nope.invalid/', 'https://nope.invalid/', -105, 'ERR_NAME_NOT_RESOLVED'), 'Can’t find that site.');
  assert.equal(at('https://x/', 'https://x/', -106, 'ERR_INTERNET_DISCONNECTED'), 'No internet connection.');
  assert.equal(at('https://x/', 'https://x/', -118, 'ERR_CONNECTION_TIMED_OUT'), 'That site took too long to answer.');
  // an unfamiliar code still reads as a sentence, never a constant
  assert.equal(at('https://x/', 'https://x/', -999, 'ERR_SOMETHING_ODD'), 'This page could not load (something odd).');
});

test('with no known current page, the failure is shown rather than swallowed', () => {
  assert.match(at('https://x/', '', -2, 'ERR_FAILED'), /could not load/);
});
